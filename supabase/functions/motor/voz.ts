// Voz clonada (ElevenLabs): transforma texto em áudio com a voz do dono e guarda no Storage (cache por texto).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const API = "https://api.elevenlabs.io/v1";
export const MODELOS = { natural: "eleven_v4", qualidade: "eleven_multilingual_v2", economia: "eleven_flash_v2_5" } as const;
export type ModeloVoz = keyof typeof MODELOS;
export function modeloValido(m: unknown): ModeloVoz {
  return m === "natural" || m === "economia" ? m : "qualidade";
}

/** Etiquetas de emoção do v4 ([risos], [warmly]…). Os outros modelos leriam em voz alta, então saem do texto. */
const ETIQUETA = /\[[^\]\n]{1,40}\]\s*/g;
export function semEtiquetas(t: string) {
  return t.replace(ETIQUETA, "").replace(/[ \t]{2,}/g, " ").trim();
}

function ajustes(modelo: string) {
  // o v4 aceita estabilidade em degraus (0 = criativo, 0,5 = natural, 1 = robusto)
  if (modelo === MODELOS.natural) return { stability: 0.5, similarity_boost: 0.85, use_speaker_boost: true };
  return { stability: 0.45, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true };
}

export type ConfigVoz = { apikey: string; voice_id: string | null; modelo: ModeloVoz | null };

export async function configVoz(db: SupabaseClient, donoId: string): Promise<ConfigVoz | null> {
  const { data } = await db.from("voz_config").select("apikey, voice_id, modelo").eq("dono_id", donoId).maybeSingle();
  return (data as ConfigVoz) ?? null;
}

async function sha(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export function erroEleven(status: number, texto: string) {
  let msg = texto;
  try {
    const j = JSON.parse(texto);
    msg = j?.detail?.message ?? j?.detail?.status ?? (typeof j?.detail === "string" ? j.detail : "") ?? texto;
  } catch {
    /* texto puro */
  }
  msg = String(msg || "sem detalhes").slice(0, 220);
  if (status === 401) return new Error(`ElevenLabs recusou a chave de API (${msg})`);
  if (/quota|credits|character_limit/i.test(msg)) return new Error(`Os créditos da ElevenLabs acabaram este mês (${msg})`);
  if (/can_not_use_instant_voice_cloning|subscription|upgrade|plan/i.test(msg)) return new Error(`Seu plano da ElevenLabs não permite clonar voz: precisa do Starter ou maior (${msg})`);
  return new Error(`ElevenLabs recusou (${status}): ${msg}`);
}

/** Gera (ou reaproveita) o áudio do texto com a voz clonada. Devolve a URL pública do mp3. */
export async function audioComVoz(db: SupabaseClient, donoId: string, texto: string, cfg?: ConfigVoz | null, forcarModelo?: ModeloVoz): Promise<string | null> {
  const c = cfg ?? (await configVoz(db, donoId));
  if (!c?.apikey || !c.voice_id) return null;
  const escolhido = forcarModelo ?? modeloValido(c.modelo);
  try {
    return await gerar(db, donoId, c, texto, escolhido);
  } catch (e) {
    // se o v4 recusar algo (texto, etiqueta), tenta no modelo clássico antes de desistir — só não adianta se for chave/créditos
    if (escolhido !== "natural" || forcarModelo || /chave de API|créditos|plano/i.test((e as Error).message)) throw e;
    return await gerar(db, donoId, c, texto, "qualidade");
  }
}

async function gerar(db: SupabaseClient, donoId: string, c: ConfigVoz, texto: string, chave: ModeloVoz): Promise<string | null> {
  const modelo = MODELOS[chave];
  const t = (chave === "natural" ? texto.trim() : semEtiquetas(texto)).slice(0, 2500);
  if (!semEtiquetas(t)) return null;
  const nome = `${await sha(`${c.voice_id}|${modelo}|${t}`)}.mp3`;
  const caminho = `${donoId}/${nome}`;
  const publica = db.storage.from("voz").getPublicUrl(caminho).data.publicUrl;

  // já gerado antes com o mesmo texto: reaproveita (não gasta crédito)
  const { data: achou } = await db.storage.from("voz").list(donoId, { search: nome, limit: 1 });
  if (achou?.some((f) => f.name === nome)) return publica;

  const r = await fetch(`${API}/text-to-speech/${encodeURIComponent(c.voice_id!)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": c.apikey, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: t,
      model_id: modelo,
      language_code: modelo === MODELOS.economia ? "pt" : undefined,
      voice_settings: ajustes(modelo),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw erroEleven(r.status, await r.text());
  const bytes = new Uint8Array(await r.arrayBuffer());
  const { error } = await db.storage.from("voz").upload(caminho, bytes, { contentType: "audio/mpeg", upsert: true });
  if (error) throw new Error(`não consegui guardar o áudio (${error.message})`);
  return publica;
}
