// Regras automáticas + travas de segurança (usadas pelas regras e pelo agente)
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { agir, type Nivel } from "./meta.ts";

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
  imposto_meta?: number;
  upsells?: number;
};

export type TrafegoCfg = {
  emergencia: boolean;
  teto_diario_centavos: number;
  aumento_max_pct: number;
  gasto_min_centavos: number;
  agente_modo: "desligado" | "recomendar" | "automatico";
  agente_hora: number;
  agente_ultimo: string | null;
};

const PADRAO: TrafegoCfg = {
  emergencia: false,
  teto_diario_centavos: 0,
  aumento_max_pct: 30,
  gasto_min_centavos: 2000,
  agente_modo: "desligado",
  agente_hora: 8,
  agente_ultimo: null,
};

export async function lerCfg(db: SupabaseClient, donoId: string): Promise<TrafegoCfg> {
  const { data } = await db.from("trafego_config").select("*").eq("dono_id", donoId).maybeSingle();
  return { ...PADRAO, ...(data ?? {}) } as TrafegoCfg;
}

export function diaBR(desloc = 0) {
  return new Date(Date.now() - 3 * 3600_000 + desloc * 86_400_000).toISOString().slice(0, 10);
}
export function horaBR() {
  return new Date(Date.now() - 3 * 3600_000).getUTCHours();
}
export function inicioDiaBR() {
  return new Date(`${diaBR(0)}T03:00:00.000Z`).toISOString();
}

export function intervalo(periodo: string): [string, string] {
  switch (periodo) {
    case "ontem":
      return [diaBR(-1), diaBR(-1)];
    case "3d":
      return [diaBR(-2), diaBR(0)];
    case "7d":
      return [diaBR(-6), diaBR(0)];
    case "3d_sem_hoje":
      return [diaBR(-3), diaBR(-1)];
    case "7d_sem_hoje":
      return [diaBR(-7), diaBR(-1)];
    default:
      return [diaBR(0), diaBR(0)];
  }
}

export async function relatorioDe(db: SupabaseClient, donoId: string, nivel: Nivel, ini: string, fim: string): Promise<Linha[]> {
  const { data, error } = await db.rpc("relatorio_anuncios_de", { p_dono: donoId, p_nivel: nivel, p_inicio: ini, p_fim: fim, p_conta: null });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Linha[]).map((l) => ({
    ...l,
    orcamento_diario: l.orcamento_diario === null ? null : Number(l.orcamento_diario),
    gasto: Number(l.gasto),
    impressoes: Number(l.impressoes),
    cliques: Number(l.cliques),
    conversas_meta: Number(l.conversas_meta),
    contatos: Number(l.contatos),
    pix_gerados: Number(l.pix_gerados),
    vendas: Number(l.vendas),
    faturamento: Number(l.faturamento),
    lucro: Number(l.lucro),
    imposto_meta: Number(l.imposto_meta ?? 0),
    upsells: Number(l.upsells ?? 0),
  }));
}

const d = (a: number, b: number) => (b > 0 ? a / b : null);

/** Métricas que as regras podem usar (dinheiro em centavos, taxas em %). */
export function metricas(l: Linha): Record<string, number | null> {
  const contatosOuConversas = l.contatos || l.conversas_meta;
  return {
    gasto: l.gasto,
    vendas: l.vendas,
    contatos: l.contatos,
    conversas: l.conversas_meta,
    pix: l.pix_gerados,
    faturamento: l.faturamento,
    lucro: l.lucro,
    roas: d(l.faturamento, l.gasto),
    roi: d(l.lucro * 100, l.gasto + (l.imposto_meta ?? 0)),
    margem: d(l.lucro * 100, l.faturamento),
    custo_pix: d(l.gasto, l.pix_gerados),
    ticket: d(l.faturamento, l.vendas),
    upsells: l.upsells ?? 0,
    cpa: d(l.gasto, l.vendas),
    custo_conversa: d(l.gasto, contatosOuConversas),
    taxa_pix: d(l.pix_gerados * 100, l.contatos),
    taxa_pagamento: d(l.vendas * 100, l.pix_gerados),
    ctr: d(l.cliques * 100, l.impressoes),
    cpc: d(l.gasto, l.cliques),
    cpm: d(l.gasto * 1000, l.impressoes),
    orcamento: l.orcamento_diario,
    impressoes: l.impressoes,
    cliques: l.cliques,
  };
}

export type Condicao = { metrica: string; op: "gt" | "lt" | "gte" | "lte"; valor: number };

export function confere(l: Linha, conds: Condicao[]) {
  const m = metricas(l);
  return conds.every((c) => {
    const v = m[c.metrica];
    if (v === null || v === undefined) return false;
    const alvo = Number(c.valor);
    return c.op === "gt" ? v > alvo : c.op === "lt" ? v < alvo : c.op === "gte" ? v >= alvo : v <= alvo;
  });
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Soma dos orçamentos diários ativos (campanhas com orçamento + conjuntos de campanhas sem orçamento). */
async function orcamentoAtivoTotal(db: SupabaseClient, donoId: string) {
  const { data: camps } = await db.from("meta_campanhas").select("id, orcamento_diario, status").eq("dono_id", donoId);
  const { data: sets } = await db.from("meta_conjuntos").select("campanha_id, orcamento_diario, status").eq("dono_id", donoId);
  const cbo = new Set((camps ?? []).filter((c) => c.orcamento_diario).map((c) => c.id));
  const ativas = new Set((camps ?? []).filter((c) => c.status === "ACTIVE").map((c) => c.id));
  let t = 0;
  for (const c of camps ?? []) if (c.status === "ACTIVE" && c.orcamento_diario) t += Number(c.orcamento_diario);
  for (const s of sets ?? []) if (s.status === "ACTIVE" && s.orcamento_diario && !cbo.has(s.campanha_id) && ativas.has(s.campanha_id)) t += Number(s.orcamento_diario);
  return t;
}

export type Resultado = { ok: boolean; texto: string; bloqueado?: boolean };

/** Aplica uma ação no Meta respeitando todas as travas. */
export async function aplicarComTravas(
  db: SupabaseClient,
  donoId: string,
  cfg: TrafegoCfg,
  nivel: Nivel,
  l: Linha,
  acao: "pausar" | "ativar" | "aumentar" | "diminuir" | "definir",
  valor: number | null,
  origem: "regra" | "painel",
  extra: { regraId?: string; motivo?: string } = {},
): Promise<Resultado> {
  if (cfg.emergencia) return { ok: false, bloqueado: true, texto: "automações desligadas (botão de emergência)" };
  if (acao === "pausar" && l.status === "PAUSED") return { ok: false, bloqueado: true, texto: "já estava pausado" };
  if (acao === "ativar" && l.status === "ACTIVE") return { ok: false, bloqueado: true, texto: "já estava ativo" };
  if (acao !== "ativar" && l.gasto < cfg.gasto_min_centavos)
    return { ok: false, bloqueado: true, texto: `gastou ${brl(l.gasto)}, abaixo do mínimo de ${brl(cfg.gasto_min_centavos)} para mexer` };

  let novo: number | null = null;
  if (acao === "aumentar" || acao === "diminuir" || acao === "definir") {
    if (nivel === "anuncio" || !l.orcamento_diario) return { ok: false, bloqueado: true, texto: "sem orçamento diário neste nível" };
    const atual = l.orcamento_diario;
    if (acao === "aumentar") novo = Math.round(atual * (1 + Math.min(Math.max(Number(valor) || 0, 1), cfg.aumento_max_pct) / 100));
    else if (acao === "diminuir") novo = Math.round(atual * (1 - Math.min(Math.max(Number(valor) || 0, 1), 90) / 100));
    else novo = Math.round(Number(valor) || 0);
    if (novo > atual) {
      novo = Math.min(novo, Math.round(atual * (1 + cfg.aumento_max_pct / 100)));
      const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data: subiu } = await db
        .from("meta_acoes")
        .select("de, para")
        .eq("objeto_id", l.id)
        .eq("acao", "orcamento")
        .eq("ok", true)
        .gte("criado_em", desde);
      if ((subiu ?? []).some((a) => Number(a.para) > Number(a.de))) return { ok: false, bloqueado: true, texto: "já teve aumento nas últimas 24h (protege o aprendizado)" };
      if (cfg.teto_diario_centavos > 0) {
        const total = await orcamentoAtivoTotal(db, donoId);
        if (total - atual + novo > cfg.teto_diario_centavos)
          return { ok: false, bloqueado: true, texto: `passaria do teto diário de ${brl(cfg.teto_diario_centavos)} (hoje: ${brl(total)})` };
      }
    }
    if (novo < 100) novo = 100;
    if (novo === atual) return { ok: false, bloqueado: true, texto: "orçamento já está nesse valor" };
  }

  try {
    if (novo !== null) {
      await agir(db, donoId, nivel, l.id, "orcamento", novo, origem, extra);
      return { ok: true, texto: `orçamento ${brl(l.orcamento_diario ?? 0)} → ${brl(novo)}` };
    }
    await agir(db, donoId, nivel, l.id, acao === "pausar" ? "pausar" : "ativar", undefined, origem, extra);
    return { ok: true, texto: acao === "pausar" ? "pausado" : "ativado" };
  } catch (e) {
    return { ok: false, texto: String((e as Error).message).slice(0, 200) };
  }
}

const NOME_ACAO: Record<string, string> = { pausar: "pausou", ativar: "ativou", aumentar: "aumentou o orçamento de", diminuir: "reduziu o orçamento de", definir: "mudou o orçamento de" };

/** Roda as regras ativas que estão no horário. */
export async function avaliarRegras(db: SupabaseClient, donoId: string) {
  const cfg = await lerCfg(db, donoId);
  if (cfg.emergencia) return { regras: 0, acoes: 0 };
  const { data: regras } = await db.from("meta_regras").select("*").eq("dono_id", donoId).eq("ativa", true);
  const agora = Date.now();
  const h = horaBR();
  let acoes = 0;
  let rodadas = 0;
  for (const r of regras ?? []) {
    if (r.ultima_execucao && agora - new Date(r.ultima_execucao).getTime() < r.frequencia_min * 60_000 - 30_000) continue;
    if (!(h >= r.hora_inicio && h < r.hora_fim)) continue;
    await db.from("meta_regras").update({ ultima_execucao: new Date().toISOString() }).eq("id", r.id);
    rodadas++;
    const [ini, fim] = intervalo(r.periodo);
    let linhas = await relatorioDe(db, donoId, r.nivel, ini, fim);
    linhas = linhas.filter((l) => (r.alvo === "pausados" ? l.status === "PAUSED" : l.status === "ACTIVE"));
    if (r.filtro_nome) linhas = linhas.filter((l) => l.nome.toLowerCase().includes(String(r.filtro_nome).toLowerCase()));
    if (r.so_pausados_por_regra) {
      const { data: pausadosHoje } = await db.from("meta_acoes").select("objeto_id").eq("dono_id", donoId).eq("acao", "pausar").eq("origem", "regra").eq("ok", true).gte("criado_em", inicioDiaBR());
      const ids = new Set((pausadosHoje ?? []).map((p) => p.objeto_id));
      linhas = linhas.filter((l) => ids.has(l.id));
    }
    const feitos: string[] = [];
    for (const l of linhas) {
      if (!confere(l, (r.condicoes ?? []) as Condicao[])) continue;
      const { count } = await db.from("meta_acoes").select("id", { count: "exact", head: true }).eq("regra_id", r.id).eq("objeto_id", l.id).eq("ok", true).gte("criado_em", inicioDiaBR());
      if ((count ?? 0) >= r.limite_dia) continue;
      const res = await aplicarComTravas(db, donoId, cfg, r.nivel, l, r.acao, r.valor === null ? null : Number(r.valor), "regra", { regraId: r.id, motivo: `regra “${r.nome}”` });
      if (res.ok) {
        acoes++;
        feitos.push(`${l.nome} (${res.texto})`);
      }
    }
    if (feitos.length) {
      await db.from("avisos").insert({
        dono_id: donoId,
        tipo: "trafego",
        link: "/anuncios",
        texto: `Regra “${r.nome}” ${NOME_ACAO[r.acao] ?? "agiu em"} ${feitos.length} item(ns): ${feitos.slice(0, 3).join("; ")}${feitos.length > 3 ? "…" : ""}`.slice(0, 480),
      });
    }
  }
  return { regras: rodadas, acoes };
}
