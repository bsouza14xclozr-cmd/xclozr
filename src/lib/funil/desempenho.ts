"use client";

// "Onde desistem": quantas pessoas passaram por cada bloco do funil, quantas estão paradas nele
// e quantas saíram por cada saída. Usa o histórico real do robô (execucoes_bloco) e o bloco atual dos contatos.
import { createContext, useContext } from "react";
import { createClient } from "@/lib/supabase/client";

export type Desempenho = {
  /** pessoas que entraram no funil (passaram pelo Início) */
  entraram: number;
  /** pessoas que pagaram algum Pix deste funil */
  compraram: number;
  blocos: Record<string, { passaram: number; parados: number }>;
  /** chave `${blocoId}|${saida}` → pessoas que saíram por ali */
  saidas: Record<string, number>;
  /** o histórico foi cortado por ser grande demais */
  cortado: boolean;
};

const LIMITE = 60_000;

export async function carregarDesempenho(funilId: string, dias: number | null, inicioId?: string): Promise<Desempenho> {
  const supabase = createClient();
  const desde = dias ? new Date(Date.now() - dias * 86_400_000).toISOString() : null;

  const passaram = new Map<string, Set<string>>();
  const saidas = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => {
    let s = m.get(k);
    if (!s) m.set(k, (s = new Set()));
    s.add(v);
  };

  let cortado = false;
  for (let de = 0; ; de += 1000) {
    let q = supabase.from("execucoes_bloco").select("bloco_id, contato_id, saida").eq("funil_id", funilId).not("contato_id", "is", null);
    if (desde) q = q.gte("criado_em", desde);
    const { data, error } = await q.order("criado_em").range(de, de + 999);
    if (error) throw new Error("Não consegui carregar o histórico do funil.");
    for (const r of data ?? []) {
      add(passaram, r.bloco_id, r.contato_id);
      if (r.saida) add(saidas, `${r.bloco_id}|${r.saida}`, r.contato_id);
    }
    if (!data || data.length < 1000) break;
    if (de + 1000 >= LIMITE) {
      cortado = true;
      break;
    }
  }

  // quem está parado agora em cada bloco (esperando resposta, Pix, etc.)
  let qp = supabase.from("contatos").select("id, bloco_atual").eq("funil_id", funilId).eq("finalizado", false).eq("simulacao", false).not("bloco_atual", "is", null);
  if (desde) qp = qp.gte("ultima_msg_em", desde);
  const { data: parados } = await qp.limit(10_000);
  const paradosPor = new Map<string, number>();
  for (const c of parados ?? []) {
    paradosPor.set(c.bloco_atual, (paradosPor.get(c.bloco_atual) ?? 0) + 1);
    add(passaram, c.bloco_atual, c.id);
  }

  const blocos: Desempenho["blocos"] = {};
  for (const [id, s] of passaram) blocos[id] = { passaram: s.size, parados: paradosPor.get(id) ?? 0 };
  const porSaida: Desempenho["saidas"] = {};
  const compradores = new Set<string>();
  for (const [k, s] of saidas) {
    porSaida[k] = s.size;
    if (k.endsWith("|pagou")) s.forEach((c) => compradores.add(c));
  }

  // "entraram" = quem passou pelo bloco de início (ou, se não houver registro, o maior bloco)
  const inicio = inicioId ? blocos[inicioId]?.passaram : undefined;
  const entraram = inicio ?? Math.max(0, ...Object.values(blocos).map((b) => b.passaram));
  return { entraram, compraram: compradores.size, blocos, saidas: porSaida, cortado };
}

export const DesempenhoContext = createContext<Desempenho | null>(null);
export const useDesempenho = () => useContext(DesempenhoContext);

export function pct(parte: number, todo: number) {
  if (!todo) return "0%";
  const v = (parte / todo) * 100;
  return `${v < 10 && v > 0 ? v.toFixed(1).replace(".", ",") : Math.round(v)}%`;
}
