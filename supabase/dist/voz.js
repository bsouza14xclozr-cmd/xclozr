// supabase/functions/voz/index.ts
import { createClient } from "@supabase/supabase-js";

// supabase/functions/motor/voz.ts
var API = "https://api.elevenlabs.io/v1";
var MODELOS = { natural: "eleven_v4", qualidade: "eleven_multilingual_v2", economia: "eleven_flash_v2_5" };
function modeloValido(m) {
  return m === "natural" || m === "economia" ? m : "qualidade";
}
var ETIQUETA = /\[[^\]\n]{1,40}\]\s*/g;
function semEtiquetas(t) {
  return t.replace(ETIQUETA, "").replace(/[ \t]{2,}/g, " ").trim();
}
function ajustes(modelo) {
  if (modelo === MODELOS.natural) return { stability: 0.5, similarity_boost: 0.85, use_speaker_boost: true };
  return { stability: 0.45, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true };
}
async function configVoz(db2, donoId) {
  const { data } = await db2.from("voz_config").select("apikey, voice_id, modelo").eq("dono_id", donoId).maybeSingle();
  return data ?? null;
}
async function sha(t) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
function erroEleven(status, texto) {
  let msg = texto;
  try {
    const j = JSON.parse(texto);
    msg = j?.detail?.message ?? j?.detail?.status ?? (typeof j?.detail === "string" ? j.detail : "") ?? texto;
  } catch {
  }
  msg = String(msg || "sem detalhes").slice(0, 220);
  if (status === 401) return new Error(`ElevenLabs recusou a chave de API (${msg})`);
  if (/quota|credits|character_limit/i.test(msg)) return new Error(`Os créditos da ElevenLabs acabaram este mês (${msg})`);
  if (/can_not_use_instant_voice_cloning|subscription|upgrade|plan/i.test(msg)) return new Error(`Seu plano da ElevenLabs não permite clonar voz: precisa do Starter ou maior (${msg})`);
  return new Error(`ElevenLabs recusou (${status}): ${msg}`);
}
async function audioComVoz(db2, donoId, texto, cfg, forcarModelo) {
  const c = cfg ?? await configVoz(db2, donoId);
  if (!c?.apikey || !c.voice_id) return null;
  const escolhido = forcarModelo ?? modeloValido(c.modelo);
  try {
    return await gerar(db2, donoId, c, texto, escolhido);
  } catch (e) {
    if (escolhido !== "natural" || forcarModelo || /chave de API|créditos|plano/i.test(e.message)) throw e;
    return await gerar(db2, donoId, c, texto, "qualidade");
  }
}
async function gerar(db2, donoId, c, texto, chave) {
  const modelo = MODELOS[chave];
  const t = (chave === "natural" ? texto.trim() : semEtiquetas(texto)).slice(0, 2500);
  if (!semEtiquetas(t)) return null;
  const nome = `${await sha(`${c.voice_id}|${modelo}|${t}`)}.mp3`;
  const caminho = `${donoId}/${nome}`;
  const publica = db2.storage.from("voz").getPublicUrl(caminho).data.publicUrl;
  const { data: achou } = await db2.storage.from("voz").list(donoId, { search: nome, limit: 1 });
  if (achou?.some((f) => f.name === nome)) return publica;
  const r = await fetch(`${API}/text-to-speech/${encodeURIComponent(c.voice_id)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": c.apikey, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: t,
      model_id: modelo,
      language_code: modelo === MODELOS.economia ? "pt" : void 0,
      voice_settings: ajustes(modelo)
    }),
    signal: AbortSignal.timeout(6e4)
  });
  if (!r.ok) throw erroEleven(r.status, await r.text());
  const bytes = new Uint8Array(await r.arrayBuffer());
  const { error } = await db2.storage.from("voz").upload(caminho, bytes, { contentType: "audio/mpeg", upsert: true });
  if (error) throw new Error(`não consegui guardar o áudio (${error.message})`);
  return publica;
}

// supabase/functions/voz/index.ts
var API2 = "https://api.elevenlabs.io/v1";
var db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false }
});
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "content-type": "application/json" } });
async function usuario(req) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data } = jwt ? await db.auth.getUser(jwt) : { data: null };
  return data?.user ?? null;
}
async function config(donoId) {
  const { data } = await db.from("voz_config").select("apikey, voice_id, modelo, voz_nome, plano, ok, erro, atualizado_em").eq("dono_id", donoId).maybeSingle();
  return data;
}
async function painel(req, donoId) {
  const corpo = await req.json().catch(() => ({}));
  const acao = String(corpo.acao ?? "status");
  const cfg = await config(donoId);
  if (acao === "status") {
    if (!cfg) return json({ conectado: false });
    return json({ conectado: true, voz_pronta: Boolean(cfg.voice_id), voz_nome: cfg.voz_nome, modelo: cfg.modelo ?? "qualidade", plano: cfg.plano, erro: cfg.erro, atualizado_em: cfg.atualizado_em });
  }
  if (acao === "chave") {
    const apikey = String(corpo.apikey ?? "").trim() || cfg?.apikey || "";
    const modelo = modeloValido(corpo.modelo);
    if (apikey.length < 20) return json({ erro: "Cole a chave de API da ElevenLabs." }, 400);
    const r = await fetch(`${API2}/user/subscription`, { headers: { "xi-api-key": apikey }, signal: AbortSignal.timeout(15e3) });
    const texto = await r.text();
    if (!r.ok) {
      const r2 = await fetch(`${API2}/voices?show_legacy=false`, { headers: { "xi-api-key": apikey }, signal: AbortSignal.timeout(15e3) });
      if (!r2.ok) return json({ erro: `Não funcionou: ${erroEleven(r.status, texto).message}` }, 400);
    }
    let plano = null;
    let avisoPlano = null;
    try {
      const j = JSON.parse(texto);
      plano = j?.tier ?? null;
      if (j?.can_use_instant_voice_cloning === false) avisoPlano = "Sua conta da ElevenLabs ainda não pode clonar voz: assine o plano Starter (ou maior) e conecte de novo.";
    } catch {
    }
    const { error } = await db.from("voz_config").upsert({ dono_id: donoId, apikey, modelo, plano, ok: true, erro: avisoPlano, atualizado_em: (/* @__PURE__ */ new Date()).toISOString() });
    if (error) return json({ erro: "Não consegui salvar." }, 500);
    return json({ ok: true, plano, aviso: avisoPlano });
  }
  if (!cfg) return json({ erro: "Conecte a ElevenLabs primeiro." }, 400);
  if (acao === "previa") {
    if (!cfg.voice_id) return json({ erro: "Clone sua voz primeiro." }, 400);
    const texto = String(corpo.texto ?? "").trim().slice(0, 400) || "Oi! Tudo bem? Vi que você chamou aqui, já te explico tudinho, tá?";
    try {
      if (corpo.comparar) {
        const [natural, classica] = await Promise.all([audioComVoz(db, donoId, texto, cfg, "natural"), audioComVoz(db, donoId, texto, cfg, "qualidade")]);
        return json({ ok: true, url: natural, natural, classica });
      }
      const url = await audioComVoz(db, donoId, texto, cfg);
      return json({ ok: true, url });
    } catch (e) {
      return json({ erro: e.message }, 400);
    }
  }
  if (acao === "remover") {
    if (cfg.voice_id) await fetch(`${API2}/voices/${encodeURIComponent(cfg.voice_id)}`, { method: "DELETE", headers: { "xi-api-key": cfg.apikey } }).catch(() => null);
    await db.from("voz_config").update({ voice_id: null, voz_nome: null, atualizado_em: (/* @__PURE__ */ new Date()).toISOString() }).eq("dono_id", donoId);
    return json({ ok: true });
  }
  if (acao === "modelo") {
    const modelo = modeloValido(corpo.modelo);
    await db.from("voz_config").update({ modelo, atualizado_em: (/* @__PURE__ */ new Date()).toISOString() }).eq("dono_id", donoId);
    return json({ ok: true, modelo });
  }
  return json({ erro: "ação desconhecida" }, 400);
}
async function clonar(req, donoId, email) {
  const cfg = await config(donoId);
  if (!cfg?.apikey) return json({ erro: "Conecte a ElevenLabs primeiro." }, 400);
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!form || !(audio instanceof File) || audio.size < 2e4) return json({ erro: "Grave ou envie um áudio de pelo menos 30 segundos." }, 400);
  if (audio.size > 20 * 1024 * 1024) return json({ erro: "Áudio grande demais (máximo 20 MB)." }, 400);
  if (form.get("consentimento") !== "sim") return json({ erro: "Confirme que a voz é sua." }, 400);
  const envio = new FormData();
  const nome = `XClozr ${(email ?? donoId).split("@")[0]}`.slice(0, 60);
  envio.append("name", nome);
  envio.append("description", "Voz do dono da conta, clonada no XClozr para áudios do robô de vendas no WhatsApp.");
  envio.append("remove_background_noise", "true");
  envio.append("files", audio, audio.name || "minha-voz.webm");
  const r = await fetch(`${API2}/voices/add`, { method: "POST", headers: { "xi-api-key": cfg.apikey }, body: envio, signal: AbortSignal.timeout(9e4) });
  const texto = await r.text();
  if (!r.ok) return json({ erro: `Não consegui clonar: ${erroEleven(r.status, texto).message}` }, 400);
  const voiceId = JSON.parse(texto)?.voice_id;
  if (!voiceId) return json({ erro: "A ElevenLabs não devolveu a voz." }, 400);
  if (cfg.voice_id && cfg.voice_id !== voiceId) await fetch(`${API2}/voices/${encodeURIComponent(cfg.voice_id)}`, { method: "DELETE", headers: { "xi-api-key": cfg.apikey } }).catch(() => null);
  await db.from("voz_config").update({ voice_id: voiceId, voz_nome: nome, erro: null, ok: true, atualizado_em: (/* @__PURE__ */ new Date()).toISOString() }).eq("dono_id", donoId);
  let previa = null;
  try {
    previa = await audioComVoz(db, donoId, "Oi! Tudo bem? Vi que você chamou aqui, já te explico tudinho, tá?", { ...cfg, voice_id: voiceId });
  } catch {
  }
  return json({ ok: true, previa });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const rota = new URL(req.url).pathname.replace(/^.*\/voz/, "") || "/";
  try {
    const u = await usuario(req);
    if (!u) return json({ erro: "não autenticado" }, 401);
    if (rota === "/clonar" && req.method === "POST") return await clonar(req, u.id, u.email ?? null);
    if (req.method === "POST") return await painel(req, u.id);
    return json({ erro: "rota não encontrada" }, 404);
  } catch (e) {
    console.error(e);
    return json({ erro: "falha interna" }, 500);
  }
});
