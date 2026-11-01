// Módulo Tráfego — chamadas ao servidor e tipos (isolado para virar módulo pago no SaaS)
import { createClient } from "@/lib/supabase/client";

export type Nivel = "campanha" | "conjunto" | "anuncio";

export type Linha = {
  id: string;
  nome: string;
  status: string | null;
  status_efetivo: string | null;
  conta_id: string;
  campanha_id: string;
  conjunto_id: string | null;
  orcamento_diario: number | null;
  gasto: number;
  impressoes: number;
  cliques: number;
  conversas_meta: number;
  contatos: number;
  pix_gerados: number;
  vendas: number;
  faturamento: number;
  lucro: number;
  taxas: number;
  custo_produtos: number;
  imposto_venda: number;
  imposto_meta: number;
  upsells: number;
  faturamento_upsell: number;
};

export type StatusMeta = {
  conectado: boolean;
  usuario: string | null;
  escolhidas: string[];
  contas: { id: string; nome: string; moeda: string | null; status: number | null }[];
  ultimo_sync: string | null;
  erro: string | null;
};

export async function chamarTrafego<T = Record<string, unknown>>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke("trafego/painel", { body: corpo });
  if (error) {
    let msg = "Algo deu errado.";
    try {
      const j = await (error as { context?: Response }).context?.json();
      if (j?.erro) msg = j.erro;
    } catch {
      /* sem corpo */
    }
    throw new Error(msg);
  }
  if (data && typeof data === "object" && "erro" in data && (data as { erro?: string }).erro) throw new Error(String((data as { erro: string }).erro));
  return data as T;
}

const NUMERICOS = [
  "gasto", "impressoes", "cliques", "conversas_meta", "contatos", "pix_gerados", "vendas", "faturamento", "lucro",
  "taxas", "custo_produtos", "imposto_venda", "imposto_meta", "upsells", "faturamento_upsell",
] as const;

export async function relatorio(nivel: Nivel, inicio: string, fim: string, conta: string | null) {
  const { data, error } = await createClient().rpc("relatorio_anuncios", { p_nivel: nivel, p_inicio: inicio, p_fim: fim, p_conta: conta });
  if (error) throw error;
  // bigint chega como número ou texto: normaliza tudo para número
  return ((data ?? []) as Record<string, unknown>[]).map((l) => {
    const o = { ...l } as Record<string, unknown>;
    for (const k of NUMERICOS) o[k] = Number(l[k] ?? 0);
    o.orcamento_diario = l.orcamento_diario == null ? null : Number(l.orcamento_diario);
    return o as Linha;
  });
}

/** Data de hoje em Brasília (AAAA-MM-DD), com deslocamento em dias. */
export function diaBR(desloc = 0) {
  return new Date(Date.now() - 3 * 3600_000 + desloc * 86_400_000).toISOString().slice(0, 10);
}

export type Periodo = "hoje" | "ontem" | "7d" | "30d" | "mes";
export const PERIODOS: { v: Periodo; nome: string }[] = [
  { v: "hoje", nome: "Hoje" },
  { v: "ontem", nome: "Ontem" },
  { v: "7d", nome: "7 dias" },
  { v: "30d", nome: "30 dias" },
  { v: "mes", nome: "Este mês" },
];
export function intervaloDias(p: Periodo): [string, string] {
  if (p === "hoje") return [diaBR(0), diaBR(0)];
  if (p === "ontem") return [diaBR(-1), diaBR(-1)];
  if (p === "7d") return [diaBR(-6), diaBR(0)];
  if (p === "30d") return [diaBR(-29), diaBR(0)];
  return [diaBR(0).slice(0, 8) + "01", diaBR(0)];
}
