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

export async function configMotor(db: SupabaseClient) {
  const { data } = await db.from("motor_config").select("chave, valor");
  return Object.fromEntries((data ?? []).map((l: { chave: string; valor: string }) => [l.chave, l.valor])) as Record<string, string>;
}

export function criarEnvioEvolution(db: SupabaseClient, cfg: Record<string, string>): Envio {
  const base = (cfg.evolution_url ?? "").replace(/\/+$/, "");
  const apikey = cfg.evolution_apikey ?? "";

  return {
    async enviar(c: Contato & { numero_id?: string | null }, s: Saida) {
      if (!base || !apikey) throw new Error("Evolution não configurada");
      const { data: numero } = await db.from("numeros").select("instancia").eq("id", c.numero_id ?? "").maybeSingle();
      if (!numero) throw new Error("contato sem número (chip) associado");
      const inst = encodeURIComponent(numero.instancia);
      const delay = Math.min(Math.max(s.esperaMs, 0), 25_000); // a Evolution mostra "digitando…/gravando…" durante o delay

      let rota: string;
      let corpo: Record<string, unknown>;
      if (s.tipo === "texto") {
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
