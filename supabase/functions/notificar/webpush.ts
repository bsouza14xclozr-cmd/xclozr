// Web Push (RFC 8291 aes128gcm + VAPID RFC 8292) só com WebCrypto — funciona no Deno (edge) e no Node 20+.

const enc = new TextEncoder();

export function b64u(buf: ArrayBuffer | Uint8Array) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function deB64u(s: string) {
  const t = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function juntar(...partes: Uint8Array[]) {
  const total = partes.reduce((t, p) => t + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export type ChavesVapid = { publica: string; privadaJwk: JsonWebKey };

/** Gera o par de chaves VAPID (a privada fica só no servidor). */
export async function gerarVapid(): Promise<ChavesVapid> {
  const par = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const crua = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
  const privadaJwk = await crypto.subtle.exportKey("jwk", par.privateKey);
  return { publica: b64u(crua), privadaJwk };
}

async function jwtVapid(endpoint: string, chaves: ChavesVapid, contato: string) {
  const aud = new URL(endpoint).origin;
  const cab = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const corpo = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contato })));
  const chave = await crypto.subtle.importKey("jwk", chaves.privadaJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const assinatura = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, chave, enc.encode(`${cab}.${corpo}`));
  return `${cab}.${corpo}.${b64u(assinatura)}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, tamanho: number) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, tamanho * 8));
}

/** Criptografa a mensagem para a inscrição do navegador (aes128gcm, um registro só). */
export async function criptografar(payload: Uint8Array, p256dh: string, auth: string, sal?: Uint8Array) {
  const uaPub = deB64u(p256dh);
  const segredo = deB64u(auth);
  const efemera = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", efemera.publicKey));
  const uaChave = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const compartilhado = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaChave }, efemera.privateKey, 256));
  const ikm = await hkdf(segredo, compartilhado, juntar(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = sal ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const chaveAes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, chaveAes, juntar(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return juntar(salt, rs, new Uint8Array([asPub.length]), asPub, cifrado);
}

export type Inscricao = { endpoint: string; p256dh: string; auth: string };

/** Envia uma notificação. Devolve o status HTTP do serviço de push (201 = ok; 404/410 = inscrição morta). */
export async function enviarPush(insc: Inscricao, dados: unknown, chaves: ChavesVapid, contato = "mailto:contato@xclozr.app", ttl = 86400) {
  const corpo = await criptografar(enc.encode(JSON.stringify(dados)), insc.p256dh, insc.auth);
  const jwt = await jwtVapid(insc.endpoint, chaves, contato);
  const r = await fetch(insc.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${jwt}, k=${chaves.publica}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(ttl),
      urgency: "high",
    },
    body: corpo,
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) await r.text().catch(() => "");
  return r.status;
}
