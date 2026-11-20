// Voz clonada (ElevenLabs): transforma texto em áudio com a voz do dono e guarda no Storage (cache por texto).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const API = "https://api.elevenlabs.io/v1";
export const MODELOS = { qualidade: "eleven_multilingual_v2", economia: "eleven_flash_v2_5" } as const;

export type ConfigVoz = { apikey: string; voice_id: string | null; modelo: keyof typeof MODELOS | null };

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
export async function audioComVoz(db: SupabaseClient, donoId: string, texto: string, cfg?: ConfigVoz | null): Promise<string | null> {
  const t = texto.trim().slice(0, 2500);
  if (!t) return null;
  const c = cfg ?? (await configVoz(db, donoId));
  if (!c?.apikey || !c.voice_id) return null;
  const modelo = MODELOS[c.modelo ?? "qualidade"] ?? MODELOS.qualidade;
  const nome = `${await sha(`${c.voice_id}|${modelo}|${t}`)}.mp3`;
  const caminho = `${donoId}/${nome}`;
  const publica = db.storage.from("voz").getPublicUrl(caminho).data.publicUrl;

  // já gerado antes com o mesmo texto: reaproveita (não gasta crédito)
  const { data: achou } = await db.storage.from("voz").list(donoId, { search: nome, limit: 1 });
  if (achou?.some((f) => f.name === nome)) return publica;

  const r = await fetch(`${API}/text-to-speech/${encodeURIComponent(c.voice_id)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": c.apikey, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: t,
      model_id: modelo,
      language_code: modelo === MODELOS.economia ? "pt" : undefined,
      voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) throw erroEleven(r.status, await r.text());
  const bytes = new Uint8Array(await r.arrayBuffer());
  const { error } = await db.storage.from("voz").upload(caminho, bytes, { contentType: "audio/mpeg", upsert: true });
  if (error) throw new Error(`não consegui guardar o áudio (${error.message})`);
  return publica;
}
