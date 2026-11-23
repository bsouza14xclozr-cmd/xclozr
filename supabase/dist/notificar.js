// supabase/functions/notificar/index.ts
import { createClient } from "@supabase/supabase-js";

// supabase/functions/notificar/webpush.ts
var enc = new TextEncoder();
function b64u(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function deB64u(s) {
  const t = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function juntar(...partes) {
  const total = partes.reduce((t, p) => t + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
async function gerarVapid() {
  const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const crua = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
  const privadaJwk = await crypto.subtle.exportKey("jwk", par.privateKey);
  return { publica: b64u(crua), privadaJwk };
}
async function jwtVapid(endpoint, chaves, contato) {
  const aud = new URL(endpoint).origin;
  const cab = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const corpo = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1e3) + 12 * 3600, sub: contato })));
  const chave = await crypto.subtle.importKey("jwk", chaves.privadaJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const assinatura = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, chave, enc.encode(`${cab}.${corpo}`));
  return `${cab}.${corpo}.${b64u(assinatura)}`;
}
async function hkdf(salt, ikm, info, tamanho) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, tamanho * 8));
}
async function criptografar(payload, p256dh, auth, sal) {
  const uaPub = deB64u(p256dh);
  const segredo = deB64u(auth);
  const efemera = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", efemera.publicKey));
  const uaChave = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const compartilhado = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaChave }, efemera.privateKey, 256));
  const ikm = await hkdf(segredo, compartilhado, juntar(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = sal ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const chaveAes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, chaveAes, juntar(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return juntar(salt, rs, new Uint8Array([asPub.length]), asPub, cifrado);
}
async function enviarPush(insc, dados, chaves, contato = "mailto:contato@xclozr.app", ttl = 86400) {
  const corpo = await criptografar(enc.encode(JSON.stringify(dados)), insc.p256dh, insc.auth);
  const jwt = await jwtVapid(insc.endpoint, chaves, contato);
  const r = await fetch(insc.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${jwt}, k=${chaves.publica}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(ttl),
      urgency: "high"
    },
    body: corpo,
    signal: AbortSignal.timeout(15e3)
  });
  if (!r.ok) await r.text().catch(() => "");
  return r.status;
}

// supabase/functions/notificar/index.ts
var db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false }
});
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
var json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "content-type": "application/json" } });
var TITULO = {
  venda: "Venda aprovada!",
  lead: "💬 Novo lead!",
  chip: "📵 Chip desconectado",
  humano: "🙋 Cliente chamando você",
  funil: "⚠️ Problema no funil",
  trafego: "📈 Anúncios",
  resumo: "📊 Resumo do dia",
  info: "🔔 XClozr"
};
var TIPOS_PADRAO = ["venda", "lead", "chip", "humano", "funil", "trafego", "resumo", "info"];
var cacheVapid = null;
async function vapid() {
  if (cacheVapid) return cacheVapid;
  const { data } = await db.from("motor_config").select("chave, valor").in("chave", ["vapid_publica", "vapid_privada"]);
  const m = Object.fromEntries((data ?? []).map((r) => [r.chave, r.valor]));
  if (m.vapid_publica && m.vapid_privada) return cacheVapid = { publica: m.vapid_publica, privadaJwk: JSON.parse(m.vapid_privada) };
  const novas = await gerarVapid();
  const { error } = await db.from("motor_config").insert([
    { chave: "vapid_publica", valor: novas.publica },
    { chave: "vapid_privada", valor: JSON.stringify(novas.privadaJwk) }
  ]);
  if (error) {
    const { data: d2 } = await db.from("motor_config").select("chave, valor").in("chave", ["vapid_publica", "vapid_privada"]);
    const m2 = Object.fromEntries((d2 ?? []).map((r) => [r.chave, r.valor]));
    return cacheVapid = { publica: m2.vapid_publica, privadaJwk: JSON.parse(m2.vapid_privada) };
  }
  return cacheVapid = novas;
}
async function segredoOk(req) {
  const { data } = await db.from("motor_config").select("valor").eq("chave", "segredo_relogio").maybeSingle();
  return Boolean(data?.valor) && req.headers.get("x-segredo") === data.valor;
}
async function prefsDe(donos) {
  const { data } = await db.from("notif_prefs").select("dono_id, ativo, tipos, resumo_hora, resumo_ultimo").in("dono_id", donos);
  return new Map((data ?? []).map((p) => [p.dono_id, p]));
}
async function paraDono(donoId, dados) {
  const { data: inscs } = await db.from("push_inscricoes").select("id, endpoint, p256dh, auth").eq("dono_id", donoId);
  if (!inscs?.length) return 0;
  const chaves = await vapid();
  let ok = 0;
  await Promise.all(
    inscs.map(async (i) => {
      try {
        const st = await enviarPush(i, { titulo: dados.titulo, corpo: dados.corpo, link: dados.link ?? "/", tag: dados.tag }, chaves);
        if (st === 404 || st === 410) await db.from("push_inscricoes").delete().eq("id", i.id);
        else if (st >= 200 && st < 300) {
          ok++;
          await db.from("push_inscricoes").update({ ultimo_envio: (/* @__PURE__ */ new Date()).toISOString(), erro: null }).eq("id", i.id);
        } else await db.from("push_inscricoes").update({ erro: `HTTP ${st}` }).eq("id", i.id);
      } catch (e) {
        await db.from("push_inscricoes").update({ erro: String(e.message).slice(0, 200) }).eq("id", i.id);
      }
    })
  );
  return ok;
}
async function enviarPendentes() {
  const desde = new Date(Date.now() - 2 * 36e5).toISOString();
  const { data: avisos } = await db.from("avisos").select("id, dono_id, tipo, texto, link, push_titulo, push_corpo").is("push_em", null).gte("criado_em", desde).order("criado_em").limit(100);
  if (!avisos?.length) return 0;
  const { data: pegos } = await db.from("avisos").update({ push_em: (/* @__PURE__ */ new Date()).toISOString() }).in("id", avisos.map((a) => a.id)).is("push_em", null).select("id");
  const ids = new Set((pegos ?? []).map((p) => p.id));
  const prefs = await prefsDe([...new Set(avisos.map((a) => a.dono_id))]);
  let enviados = 0;
  for (const a of avisos) {
    if (!ids.has(a.id)) continue;
    const p = prefs.get(a.dono_id);
    if (p && (!p.ativo || !(p.tipos ?? TIPOS_PADRAO).includes(a.tipo))) continue;
    enviados += await paraDono(a.dono_id, {
      titulo: a.push_titulo || TITULO[a.tipo] || TITULO.info,
      corpo: a.push_corpo || a.texto,
      link: a.link,
      tag: a.tipo === "chip" ? "chip" : a.id
    });
  }
  return enviados;
}
var brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
async function resumosDiarios() {
  const agoraBR = new Date(Date.now() - 3 * 36e5);
  const hoje = agoraBR.toISOString().slice(0, 10);
  const hora = agoraBR.getUTCHours();
  const { data: lista } = await db.from("notif_prefs").select("dono_id, ativo, tipos, resumo_hora, resumo_ultimo").eq("ativo", true).eq("resumo_hora", hora);
  let feitos = 0;
  for (const p of lista ?? []) {
    if (p.resumo_ultimo === hoje || !(p.tipos ?? TIPOS_PADRAO).includes("resumo")) continue;
    await db.from("notif_prefs").update({ resumo_ultimo: hoje }).eq("dono_id", p.dono_id);
    const inicio = (/* @__PURE__ */ new Date(`${hoje}T03:00:00Z`)).toISOString();
    const [{ data: pags }, { data: gastos }, { count: leads }] = await Promise.all([
      db.from("pagamentos").select("valor_centavos, taxa_centavos, tipo").eq("dono_id", p.dono_id).eq("status", "pago").eq("simulacao", false).gte("pago_em", inicio),
      db.from("meta_insights_dia").select("anuncio_id, gasto_centavos").eq("dono_id", p.dono_id).eq("dia", hoje),
      db.from("contatos").select("id", { count: "exact", head: true }).eq("dono_id", p.dono_id).eq("simulacao", false).gte("criado_em", inicio)
    ]);
    const vendas = (pags ?? []).filter((x) => x.tipo !== "upsell").length;
    const fat = (pags ?? []).reduce((t, x) => t + x.valor_centavos, 0);
    const taxas = (pags ?? []).reduce((t, x) => t + (x.taxa_centavos ?? 0), 0);
    const gasto = (gastos ?? []).reduce((t, x) => t + Number(x.gasto_centavos), 0);
    const lucro = fat - taxas - gasto;
    const partes = [
      `${leads ?? 0} conversa${leads === 1 ? "" : "s"} nova${leads === 1 ? "" : "s"}`,
      `${vendas} venda${vendas === 1 ? "" : "s"} (${brl(fat)})`,
      gasto ? `gasto em anúncios ${brl(gasto)}` : null,
      `lucro ${brl(lucro)}`,
      gasto && vendas ? `custo por venda ${brl(Math.round(gasto / vendas))}` : null
    ].filter(Boolean);
    await db.from("avisos").insert({ dono_id: p.dono_id, tipo: "resumo", texto: `Hoje: ${partes.join(" · ")}.`, link: "/" });
    feitos++;
  }
  return feitos;
}
async function testar(req) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = jwt ? await db.auth.getUser(jwt) : { data: null };
  const donoId = u?.user?.id;
  if (!donoId) return json({ erro: "não autenticado" }, 401);
  const n = await paraDono(donoId, { titulo: "🔔 Teste do XClozr", corpo: "Prontinho! É assim que as vendas e os alertas vão chegar aqui.", link: "/", tag: "teste" });
  if (!n) return json({ erro: "Nenhum aparelho recebeu. Ative as notificações neste aparelho e tente de novo." }, 400);
  return json({ ok: true, aparelhos: n });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const rota = new URL(req.url).pathname.replace(/^.*\/notificar/, "") || "/";
  try {
    if (rota === "/chave") return json({ chave: (await vapid()).publica });
    if (rota === "/testar" && req.method === "POST") return await testar(req);
    if ((rota === "/enviar" || rota === "/cron") && req.method === "POST") {
      if (!await segredoOk(req)) return json({ erro: "segredo inválido" }, 401);
      const resumos = rota === "/cron" ? await resumosDiarios() : 0;
      const enviados = await enviarPendentes();
      return json({ ok: true, enviados, resumos });
    }
    return json({ erro: "rota não encontrada" }, 404);
  } catch (e) {
    console.error(e);
    return json({ erro: "falha interna" }, 500);
  }
});
