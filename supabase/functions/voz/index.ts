/// <reference lib="deno.ns" />
// XClozr — "Minha voz": clona a voz do dono (ElevenLabs) a partir de ~1 minuto de áudio livre.
//   POST /voz          (login) { acao: status | chave | previa | remover }
//   POST /voz/clonar   (login) multipart: audio + consentimento=sim
// A chave da ElevenLabs entra aqui e nunca volta para o navegador.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { audioComVoz, erroEleven, modeloValido, type ConfigVoz } from "../motor/voz.ts";

const API = "https://api.elevenlabs.io/v1";
const db: SupabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "content-type": "application/json" } });

async function usuario(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data } = jwt ? await db.auth.getUser(jwt) : { data: null };
  return data?.user ?? null;
}

async function config(donoId: string) {
  const { data } = await db.from("voz_config").select("apikey, voice_id, modelo, voz_nome, plano, ok, erro, atualizado_em").eq("dono_id", donoId).maybeSingle();
  return data as (ConfigVoz & { voz_nome: string | null; plano: string | null; ok: boolean; erro: string | null; atualizado_em: string }) | null;
}

async function painel(req: Request, donoId: string) {
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
    const r = await fetch(`${API}/user/subscription`, { headers: { "xi-api-key": apikey }, signal: AbortSignal.timeout(15_000) });
    const texto = await r.text();
    if (!r.ok) {
      // chaves com permissão restrita podem não ler a assinatura: aceita se conseguir listar vozes
      const r2 = await fetch(`${API}/voices?show_legacy=false`, { headers: { "xi-api-key": apikey }, signal: AbortSignal.timeout(15_000) });
      if (!r2.ok) return json({ erro: `Não funcionou: ${erroEleven(r.status, texto).message}` }, 400);
    }
    let plano: string | null = null;
    let avisoPlano: string | null = null;
    try {
      const j = JSON.parse(texto);
      plano = j?.tier ?? null;
      if (j?.can_use_instant_voice_cloning === false) avisoPlano = "Sua conta da ElevenLabs ainda não pode clonar voz: assine o plano Starter (ou maior) e conecte de novo.";
    } catch {
      /* sem detalhes do plano */
    }
    const { error } = await db.from("voz_config").upsert({ dono_id: donoId, apikey, modelo, plano, ok: true, erro: avisoPlano, atualizado_em: new Date().toISOString() });
    if (error) return json({ erro: "Não consegui salvar." }, 500);
    return json({ ok: true, plano, aviso: avisoPlano });
  }

  if (!cfg) return json({ erro: "Conecte a ElevenLabs primeiro." }, 400);

  if (acao === "previa") {
    if (!cfg.voice_id) return json({ erro: "Clone sua voz primeiro." }, 400);
    const texto = String(corpo.texto ?? "").trim().slice(0, 400) || "Oi! Tudo bem? Vi que você chamou aqui, já te explico tudinho, tá?";
    try {
      if (corpo.comparar) {
        // mesmo texto nos dois modelos, para ouvir lado a lado
        const [natural, classica] = await Promise.all([audioComVoz(db, donoId, texto, cfg, "natural"), audioComVoz(db, donoId, texto, cfg, "qualidade")]);
        return json({ ok: true, url: natural, natural, classica });
      }
      const url = await audioComVoz(db, donoId, texto, cfg);
      return json({ ok: true, url });
    } catch (e) {
      return json({ erro: (e as Error).message }, 400);
    }
  }

  if (acao === "remover") {
    if (cfg.voice_id) await fetch(`${API}/voices/${encodeURIComponent(cfg.voice_id)}`, { method: "DELETE", headers: { "xi-api-key": cfg.apikey } }).catch(() => null);
    await db.from("voz_config").update({ voice_id: null, voz_nome: null, atualizado_em: new Date().toISOString() }).eq("dono_id", donoId);
    return json({ ok: true });
  }

  if (acao === "modelo") {
    const modelo = modeloValido(corpo.modelo);
    await db.from("voz_config").update({ modelo, atualizado_em: new Date().toISOString() }).eq("dono_id", donoId);
    return json({ ok: true, modelo });
  }
  return json({ erro: "ação desconhecida" }, 400);
}

async function clonar(req: Request, donoId: string, email: string | null) {
  const cfg = await config(donoId);
  if (!cfg?.apikey) return json({ erro: "Conecte a ElevenLabs primeiro." }, 400);
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!form || !(audio instanceof File) || audio.size < 20_000) return json({ erro: "Grave ou envie um áudio de pelo menos 30 segundos." }, 400);
  if (audio.size > 20 * 1024 * 1024) return json({ erro: "Áudio grande demais (máximo 20 MB)." }, 400);
  if (form.get("consentimento") !== "sim") return json({ erro: "Confirme que a voz é sua." }, 400);

  const envio = new FormData();
  const nome = `XClozr ${(email ?? donoId).split("@")[0]}`.slice(0, 60);
  envio.append("name", nome);
  envio.append("description", "Voz do dono da conta, clonada no XClozr para áudios do robô de vendas no WhatsApp.");
  envio.append("remove_background_noise", "true");
  envio.append("files", audio, audio.name || "minha-voz.webm");
  const r = await fetch(`${API}/voices/add`, { method: "POST", headers: { "xi-api-key": cfg.apikey }, body: envio, signal: AbortSignal.timeout(90_000) });
  const texto = await r.text();
  if (!r.ok) return json({ erro: `Não consegui clonar: ${erroEleven(r.status, texto).message}` }, 400);
  const voiceId = JSON.parse(texto)?.voice_id as string | undefined;
  if (!voiceId) return json({ erro: "A ElevenLabs não devolveu a voz." }, 400);

  // apaga a voz antiga (a nova já está pronta)
  if (cfg.voice_id && cfg.voice_id !== voiceId) await fetch(`${API}/voices/${encodeURIComponent(cfg.voice_id)}`, { method: "DELETE", headers: { "xi-api-key": cfg.apikey } }).catch(() => null);
  await db.from("voz_config").update({ voice_id: voiceId, voz_nome: nome, erro: null, ok: true, atualizado_em: new Date().toISOString() }).eq("dono_id", donoId);

  // prévia já pronta para ouvir
  let previa: string | null = null;
  try {
    previa = await audioComVoz(db, donoId, "Oi! Tudo bem? Vi que você chamou aqui, já te explico tudinho, tá?", { ...cfg, voice_id: voiceId });
  } catch {
    /* a voz foi criada; a prévia pode ser pedida depois */
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

