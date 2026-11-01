// Envio de mensagens pelo WhatsApp (Evolution API v2)
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Contato, Envio, Saida } from "./motor.ts";

/** No simulador nada vai para o WhatsApp: as mensagens ficam só no banco. */
export const envioSimulado: Envio = { enviar: async () => {} };

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
          fileName: s.tipo === "arquivo" ? s.nome : undefined,
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
