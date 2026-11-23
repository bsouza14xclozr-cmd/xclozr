// Envio de mensagens pelo WhatsApp (Evolution API v2)
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Contato, Envio, Saida } from "./motor.ts";

/** No simulador nada vai para o WhatsApp: as mensagens ficam só no banco. */
export const envioSimulado: Envio = { enviar: async () => {} };

const MIMES: Record<string, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  epub: "application/epub+zip",
  txt: "text/plain",
};
function extensaoDe(url: string) {
  const m = decodeURIComponent((url ?? "").split("?")[0]).match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : "";
}
function mimeDe(url: string) {
  return MIMES[extensaoDe(url)] ?? undefined;
}
/** "Receitas de Geladinho" + ".../apostila.pdf" → "Receitas de Geladinho.pdf" (o WhatsApp precisa da extensão para abrir). */
export function nomeComExtensao(nome: string, url: string) {
  const ext = extensaoDe(url);
  const base = (nome || "arquivo").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "arquivo";
  return ext && !base.toLowerCase().endsWith(`.${ext}`) ? `${base}.${ext}` : base;
}

/* ------------------------------------------------------------------ */
/* Ritmo humano: "digitando…" proporcional ao texto, "gravando…" do      */
/* tamanho do áudio. O tempo configurado no funil vale como mínimo.      */
/* ------------------------------------------------------------------ */

const MAX_DELAY_TEXTO = 22_000;
const MAX_DELAY_AUDIO = 30_000;
/** Depois de tanto tempo esperando na mesma execução, volta ao tempo configurado (a função tem limite de duração). */
const ORCAMENTO_MS = 110_000;

const duracoes = new Map<string, number | null>();

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** Bitrate (kbps) do primeiro quadro MP3, pulando a etiqueta ID3. */
export function bitrateMp3(b: Uint8Array): number | null {
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  }
  for (; i + 3 < b.length; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const versao = (b[i + 1] >> 3) & 3; // 3 = MPEG1
    const camada = (b[i + 1] >> 1) & 3; // 1 = Layer III
    const idx = (b[i + 2] >> 4) & 0xf;
    if (camada !== 1 || idx === 0 || idx === 15 || versao === 1) continue;
    return (versao === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[idx] || null;
  }
  return null;
}

/** Duração aproximada (s) de um áudio pela URL: tamanho do arquivo ÷ bitrate. */
export async function duracaoAudio(url: string): Promise<number | null> {
  if (duracoes.has(url)) return duracoes.get(url)!;
  let seg: number | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(url, { headers: { range: "bytes=0-16383" }, signal: ctrl.signal });
    clearTimeout(t);
    const buf = new Uint8Array(await r.arrayBuffer());
    const total = Number((r.headers.get("content-range") ?? "").split("/")[1]) || Number(r.headers.get("content-length")) || buf.length;
    const ehMp3 = /\.mp3(\?|$)/i.test(url) || (r.headers.get("content-type") ?? "").includes("mpeg") || bitrateMp3(buf) !== null;
    const kbps = ehMp3 ? bitrateMp3(buf) ?? 128 : 32; // ogg/opus de WhatsApp ≈ 32 kbps
    if (total > 0) seg = (total * 8) / (kbps * 1000);
  } catch {
    seg = null;
  }
  duracoes.set(url, seg);
  return seg;
}

function variar(ms: number) {
  return Math.round(ms * (0.9 + Math.random() * 0.2));
}

/** Quanto tempo uma pessoa levaria para digitar / gravar / anexar isso. */
export async function tempoHumano(s: Saida): Promise<number> {
  if (s.tipo === "texto") {
    const n = s.texto.length;
    return Math.min(MAX_DELAY_TEXTO, variar(1800 + n * 55)); // ~18 caracteres por segundo + o tempo de "pensar"
  }
  if (s.tipo === "audio") {
    const d = await duracaoAudio(s.url);
    if (!d) return 6000;
    return Math.min(MAX_DELAY_AUDIO, Math.max(3000, variar(d * 1000 + 800)));
  }
  if (s.tipo === "arquivo") return variar(3500);
  if (s.tipo === "botao_copiar") return variar(2500);
  return variar(2500 + ("legenda" in s ? Math.min(6000, (s.legenda ?? "").length * 40) : 0));
}

export async function configMotor(db: SupabaseClient) {
  const { data } = await db.from("motor_config").select("chave, valor");
  return Object.fromEntries((data ?? []).map((l: { chave: string; valor: string }) => [l.chave, l.valor])) as Record<string, string>;
}

export function criarEnvioEvolution(db: SupabaseClient, cfg: Record<string, string>): Envio {
  const base = (cfg.evolution_url ?? "").replace(/\/+$/, "");
  const apikey = cfg.evolution_apikey ?? "";
  let gasto = 0; // tempo de "digitando/gravando" já usado nesta execução

  return {
    async enviar(c: Contato & { numero_id?: string | null }, s: Saida) {
      if (!base || !apikey) throw new Error("Evolution não configurada");
      const { data: numero } = await db.from("numeros").select("instancia").eq("id", c.numero_id ?? "").maybeSingle();
      if (!numero) throw new Error("contato sem número (chip) associado");
      const inst = encodeURIComponent(numero.instancia);
      // a Evolution mostra "digitando…/gravando…" durante o delay
      const configurado = Math.max(s.esperaMs, 0);
      const humano = gasto < ORCAMENTO_MS ? await tempoHumano(s) : 0;
      const delay = Math.min(Math.max(configurado, humano), s.tipo === "audio" ? MAX_DELAY_AUDIO : 25_000);
      gasto += delay;

      let rota: string;
      let corpo: Record<string, unknown>;
      if (s.tipo === "botao_copiar") {
        rota = `/message/sendButtons/${inst}`;
        corpo = {
          number: c.telefone,
          title: s.titulo,
          description: s.texto,
          footer: s.rodape ?? "",
          buttons: [{ type: "copy", displayText: s.rotulo, copyCode: s.codigo }],
          delay,
        };
      } else if (s.tipo === "texto") {
        rota = `/message/sendText/${inst}`;
        corpo = { number: c.telefone, text: s.texto, delay };
      } else if (s.tipo === "audio") {
        rota = `/message/sendWhatsAppAudio/${inst}`;
        corpo = { number: c.telefone, audio: s.url, delay };
      } else {
        rota = `/message/sendMedia/${inst}`;
        corpo = {
          number: c.telefone,
          mediatype: s.tipo === "arquivo" ? "document" : s.tipo,
          media: s.url,
          caption: "legenda" in s ? s.legenda : undefined,
          fileName: s.tipo === "arquivo" ? nomeComExtensao(s.nome, s.url) : undefined,
          mimetype: s.tipo === "arquivo" ? mimeDe(s.url) : undefined,
          delay,
        };
      }

      const r = await fetch(`${base}${rota}`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey },
        body: JSON.stringify(corpo),
      });
      if (!r.ok) throw new Error(`Evolution ${r.status}: ${(await r.text()).slice(0, 200)}`);
    },
  };
}
