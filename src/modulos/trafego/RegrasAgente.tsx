"use client";

// Regras automáticas + agente de tráfego com IA (módulo Tráfego)
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui";
import { brl, paraCentavos, paraInput } from "@/lib/dinheiro";
import { chamarTrafego, type Nivel } from "./api";

const inputCls =
  "w-full min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";
const campo = "min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto focus:border-limao focus:outline-none";
const btnSec = "min-h-11 rounded-[10px] border border-borda bg-cartao px-4 text-sm hover:bg-elevado disabled:opacity-60";
const btnPri = "min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60";

/* ------------------------------------------------------------------ */
/* Tipos e vocabulário                                                 */
/* ------------------------------------------------------------------ */

type Unidade = "brl" | "num" | "pct" | "x";
type Op = "gt" | "lt" | "gte" | "lte";
type Condicao = { metrica: string; op: Op; valor: number };
type Acao = "pausar" | "ativar" | "aumentar" | "diminuir" | "definir";
type Periodo = "hoje" | "ontem" | "3d" | "7d" | "3d_sem_hoje" | "7d_sem_hoje";

export type Regra = {
  id: string;
  nome: string;
  ativa: boolean;
  nivel: Nivel;
  alvo: "ativos" | "pausados";
  filtro_nome: string | null;
  acao: Acao;
  valor: number | null;
  condicoes: Condicao[];
  periodo: Periodo;
  frequencia_min: number;
  hora_inicio: number;
  hora_fim: number;
  limite_dia: number;
  so_pausados_por_regra: boolean;
  origem: "manual" | "recomendada";
  ultima_execucao: string | null;
};

type Travas = {
  emergencia: boolean;
  teto_diario_centavos: number;
  aumento_max_pct: number;
  gasto_min_centavos: number;
  agente_modo: "desligado" | "recomendar" | "automatico";
  agente_hora: number;
};

const METRICAS: { v: string; nome: string; u: Unidade }[] = [
  { v: "gasto", nome: "Gasto", u: "brl" },
  { v: "lucro", nome: "Lucro", u: "brl" },
  { v: "faturamento", nome: "Faturamento", u: "brl" },
  { v: "vendas", nome: "Vendas", u: "num" },
  { v: "cpa", nome: "CPA (custo por venda)", u: "brl" },
  { v: "roas", nome: "ROAS", u: "x" },
  { v: "roi", nome: "ROI", u: "pct" },
  { v: "margem", nome: "Margem", u: "pct" },
  { v: "ticket", nome: "Ticket médio", u: "brl" },
  { v: "contatos", nome: "Contatos no WhatsApp", u: "num" },
  { v: "conversas", nome: "Conversas (Meta)", u: "num" },
  { v: "custo_conversa", nome: "Custo por conversa", u: "brl" },
  { v: "pix", nome: "Pix gerados", u: "num" },
  { v: "custo_pix", nome: "Custo por Pix", u: "brl" },
  { v: "upsells", nome: "Upsells", u: "num" },
  { v: "taxa_pix", nome: "% de contatos que geram Pix", u: "pct" },
  { v: "taxa_pagamento", nome: "% de Pix pagos", u: "pct" },
  { v: "ctr", nome: "CTR", u: "pct" },
  { v: "cpc", nome: "CPC", u: "brl" },
  { v: "cpm", nome: "CPM", u: "brl" },
  { v: "impressoes", nome: "Impressões", u: "num" },
  { v: "cliques", nome: "Cliques", u: "num" },
  { v: "orcamento", nome: "Orçamento diário", u: "brl" },
];
const UNIDADE = Object.fromEntries(METRICAS.map((m) => [m.v, m.u])) as Record<string, Unidade>;
const NOME_METRICA = Object.fromEntries(METRICAS.map((m) => [m.v, m.nome])) as Record<string, string>;
const OPS: { v: Op; nome: string }[] = [
  { v: "gte", nome: "≥" },
  { v: "gt", nome: ">" },
  { v: "lte", nome: "≤" },
  { v: "lt", nome: "<" },
];
const NOME_OP = Object.fromEntries(OPS.map((o) => [o.v, o.nome])) as Record<Op, string>;
const PERIODOS: { v: Periodo; nome: string }[] = [
  { v: "hoje", nome: "Hoje" },
  { v: "ontem", nome: "Ontem" },
  { v: "3d", nome: "Últimos 3 dias (com hoje)" },
  { v: "7d", nome: "Últimos 7 dias (com hoje)" },
  { v: "3d_sem_hoje", nome: "Últimos 3 dias (sem hoje)" },
  { v: "7d_sem_hoje", nome: "Últimos 7 dias (sem hoje)" },
];
const NOME_PERIODO = Object.fromEntries(PERIODOS.map((p) => [p.v, p.nome])) as Record<Periodo, string>;
const NOME_NIVEL: Record<Nivel, string> = { campanha: "campanhas", conjunto: "conjuntos", anuncio: "anúncios" };

/** valor guardado (centavos / número / %) → texto para mostrar */
function mostrarValor(u: Unidade, v: number) {
  if (u === "brl") return brl(v);
  if (u === "pct") return `${String(v).replace(".", ",")}%`;
  if (u === "x") return `${String(v).replace(".", ",")}x`;
  return v.toLocaleString("pt-BR");
}
/** texto digitado → valor guardado (dinheiro aceita negativo, para lucro) */
function lerValor(u: Unidade, texto: string): number | null {
  const neg = texto.trim().startsWith("-");
  if (u === "brl") {
    const c = paraCentavos(texto.replace("-", ""));
    return c === null ? null : neg ? -c : c;
  }
  const v = Number(texto.replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isFinite(v) && texto.trim() !== "" ? v : null;
}
function paraTexto(u: Unidade, v: number) {
  if (u === "brl") return (v < 0 ? "-" : "") + paraInput(Math.abs(v));
  return String(v).replace(".", ",");
}

function descreverAcao(r: Pick<Regra, "acao" | "valor">) {
  if (r.acao === "pausar") return "Pausar";
  if (r.acao === "ativar") return "Ativar";
  if (r.acao === "aumentar") return `Aumentar orçamento ${r.valor ?? 0}%`;
  if (r.acao === "diminuir") return `Reduzir orçamento ${r.valor ?? 0}%`;
  return `Definir orçamento em ${brl(r.valor ?? 0)}`;
}

function quando(iso: string | null) {
  if (!iso) return "ainda não rodou";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "agora há pouco";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const TRAVAS_PADRAO: Travas = { emergencia: false, teto_diario_centavos: 0, aumento_max_pct: 30, gasto_min_centavos: 2000, agente_modo: "desligado", agente_hora: 8 };

function useTravas() {
  const [travas, setTravas] = useState<Travas | null>(null);
  const carregar = useCallback(async () => {
    const { data } = await createClient()
      .from("trafego_config")
      .select("emergencia, teto_diario_centavos, aumento_max_pct, gasto_min_centavos, agente_modo, agente_hora")
      .maybeSingle();
    setTravas({ ...TRAVAS_PADRAO, ...((data ?? {}) as Partial<Travas>), teto_diario_centavos: Number(data?.teto_diario_centavos ?? 0), gasto_min_centavos: Number(data?.gasto_min_centavos ?? 2000) });
  }, []);
  const salvar = useCallback(async (patch: Partial<Travas>) => {
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("sem usuário");
    const { error } = await supabase.from("trafego_config").upsert({ dono_id: u.user.id, ...patch, atualizado_em: new Date().toISOString() });
    if (error) throw new Error("Não consegui salvar.");
    setTravas((t) => (t ? { ...t, ...patch } : t));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao abrir
    void carregar();
  }, [carregar]);
  return { travas, salvar };
}

/* ------------------------------------------------------------------ */
/* Travas de segurança                                                 */
/* ------------------------------------------------------------------ */

function CardTravas({ travas, salvar }: { travas: Travas; salvar: (p: Partial<Travas>) => Promise<void> }) {
  const [teto, setTeto] = useState(travas.teto_diario_centavos ? paraInput(travas.teto_diario_centavos) : "");
  const [aumento, setAumento] = useState(String(travas.aumento_max_pct));
  const [minimo, setMinimo] = useState(paraInput(travas.gasto_min_centavos));
  const [msg, setMsg] = useState<string | null>(null);

  async function gravar() {
    setMsg(null);
    const a = Math.round(Number(aumento));
    if (!(a >= 1 && a <= 100)) return setMsg("Aumento máximo precisa ficar entre 1% e 100%.");
    try {
      await salvar({ teto_diario_centavos: paraCentavos(teto) ?? 0, aumento_max_pct: a, gasto_min_centavos: paraCentavos(minimo) ?? 0 });
      setMsg("Travas salvas.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <Card title="🛡️ Travas de segurança">
      <p className="text-sm text-suave">Valem para as regras e para o agente de IA. Nada passa por cima delas.</p>
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${travas.emergencia ? "border-vermelho/60 bg-vermelho/10" : "border-borda bg-fundo"}`}
      >
        <div className="flex flex-col gap-0.5">
          <b className="text-sm">{travas.emergencia ? "⛔ Automações desligadas" : "Automações ligadas"}</b>
          <span className="text-xs text-suave">
            {travas.emergencia ? "Nenhuma regra nem o agente mexem nas campanhas até você religar." : "Botão de emergência: para tudo na hora, sem apagar suas regras."}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void salvar({ emergencia: !travas.emergencia }).catch((e) => setMsg((e as Error).message))}
          className={travas.emergencia ? btnPri : "min-h-11 rounded-[10px] bg-vermelho px-5 text-sm font-bold text-white hover:brightness-110"}
        >
          {travas.emergencia ? "Religar automações" : "Parar tudo"}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-suave">Teto de orçamento diário somado (R$)</span>
          <input className={inputCls} inputMode="decimal" value={teto} onChange={(e) => setTeto(e.target.value)} placeholder="sem teto" />
          <span className="text-[11px] text-suave">Nenhum aumento passa desse total.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-suave">Aumento máximo por vez (%)</span>
          <input className={inputCls} inputMode="numeric" value={aumento} onChange={(e) => setAumento(e.target.value)} />
          <span className="text-[11px] text-suave">E no máximo 1 aumento a cada 24h por item.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-suave">Gasto mínimo antes de mexer (R$)</span>
          <input className={inputCls} inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} />
          <span className="text-[11px] text-suave">Evita matar anúncio que mal começou.</span>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={gravar} className={btnSec}>
          Salvar travas
        </button>
        {msg && <span className="text-sm text-suave">{msg}</span>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Regras recomendadas (calculadas a partir do produto)                */
/* ------------------------------------------------------------------ */

type Economia = { produto: string | null; lucroVenda: number; cpaMax: number };

function useEconomia() {
  const [eco, setEco] = useState<Economia | null>(null);
  useEffect(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.from("produtos").select("nome, preco_centavos, custo_centavos, upsell_de_id, ativo").eq("ativo", true),
      supabase.from("configuracoes").select("taxa_percentual, taxa_fixa_centavos, imposto_venda_pct, imposto_meta_pct").maybeSingle(),
    ]).then(([p, c]) => {
      const prods = (p.data ?? []).filter((x) => !x.upsell_de_id);
      const tp = Number(c.data?.taxa_percentual ?? 0);
      const tf = Number(c.data?.taxa_fixa_centavos ?? 0);
      const iv = Number(c.data?.imposto_venda_pct ?? 0);
      const im = Number(c.data?.imposto_meta_pct ?? 0);
      if (!prods.length) return setEco({ produto: null, lucroVenda: 0, cpaMax: 0 });
      // usa o produto de entrada mais barato (o mais conservador)
      const pr = [...prods].sort((a, b) => a.preco_centavos - b.preco_centavos)[0];
      const lucro = Math.round(pr.preco_centavos - (pr.preco_centavos * tp) / 100 - tf - Number(pr.custo_centavos ?? 0) - (pr.preco_centavos * iv) / 100);
      setEco({ produto: pr.nome, lucroVenda: lucro, cpaMax: Math.max(0, Math.round(lucro / (1 + im / 100))) });
    });
  }, []);
  return eco;
}

type NovaRegra = Omit<Regra, "id" | "ultima_execucao">;

function base(r: Partial<NovaRegra> & Pick<NovaRegra, "nome" | "nivel" | "acao" | "condicoes">): NovaRegra {
  return {
    ativa: true,
    alvo: "ativos",
    filtro_nome: null,
    valor: null,
    periodo: "hoje",
    frequencia_min: 30,
    hora_inicio: 0,
    hora_fim: 24,
    limite_dia: 1,
    so_pausados_por_regra: false,
    origem: "recomendada",
    ...r,
  };
}

export function regrasRecomendadas(cpaMax: number): NovaRegra[] {
  const r = (x: number) => Math.round(x / 100) * 100; // arredonda para real cheio
  return [
    base({
      nome: "Pausar anúncio que gasta e não vende",
      nivel: "anuncio",
      acao: "pausar",
      condicoes: [
        { metrica: "gasto", op: "gte", valor: r(cpaMax * 1.5) },
        { metrica: "vendas", op: "lte", valor: 0 },
      ],
    }),
    base({
      nome: "Pausar anúncio que não traz conversa",
      nivel: "anuncio",
      acao: "pausar",
      condicoes: [
        { metrica: "gasto", op: "gte", valor: r(Math.max(1500, cpaMax * 0.6)) },
        { metrica: "contatos", op: "lte", valor: 0 },
        { metrica: "conversas", op: "lte", valor: 0 },
      ],
    }),
    base({
      nome: "Reduzir conjunto com CPA alto",
      nivel: "conjunto",
      acao: "diminuir",
      valor: 25,
      periodo: "3d",
      frequencia_min: 60,
      condicoes: [
        { metrica: "vendas", op: "gte", valor: 3 },
        { metrica: "cpa", op: "gt", valor: r(cpaMax * 1.3) },
      ],
    }),
    base({
      nome: "Escalar conjunto lucrativo (+20%)",
      nivel: "conjunto",
      acao: "aumentar",
      valor: 20,
      periodo: "3d",
      frequencia_min: 60,
      hora_inicio: 6,
      hora_fim: 20,
      condicoes: [
        { metrica: "vendas", op: "gte", valor: 3 },
        { metrica: "cpa", op: "lte", valor: r(cpaMax * 0.7) },
        { metrica: "lucro", op: "gt", valor: 0 },
      ],
    }),
    base({
      nome: "Escalar campanha lucrativa (+20%)",
      nivel: "campanha",
      acao: "aumentar",
      valor: 20,
      periodo: "3d",
      frequencia_min: 60,
      hora_inicio: 6,
      hora_fim: 20,
      condicoes: [
        { metrica: "vendas", op: "gte", valor: 3 },
        { metrica: "cpa", op: "lte", valor: r(cpaMax * 0.7) },
        { metrica: "lucro", op: "gt", valor: 0 },
      ],
    }),
    base({
      nome: "Reativar o que a regra pausou e voltou a vender",
      nivel: "anuncio",
      acao: "ativar",
      alvo: "pausados",
      so_pausados_por_regra: true,
      condicoes: [
        { metrica: "vendas", op: "gte", valor: 2 },
        { metrica: "lucro", op: "gt", valor: 0 },
      ],
    }),
  ];
}

function Recomendadas({ onCriar, jaTem }: { onCriar: (rs: NovaRegra[]) => Promise<void>; jaTem: boolean }) {
  const eco = useEconomia();
  const [cpa, setCpa] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState(!jaTem);
  const valorCpa = cpa !== null ? (paraCentavos(cpa) ?? 0) : (eco?.cpaMax ?? 0);
  const lista = useMemo(() => (valorCpa > 0 ? regrasRecomendadas(valorCpa) : []), [valorCpa]);

  if (!eco) return null;
  return (
    <Card title="⭐ Regras recomendadas">
      <p className="text-sm text-suave">
        Montadas por cima do seu <b className="text-texto">CPA máximo</b>: quanto você pode pagar por venda sem ter prejuízo.
        {eco.produto
          ? ` Calculei com o produto “${eco.produto}”: lucro de ${brl(eco.lucroVenda)} por venda antes do anúncio.`
          : " Cadastre um produto (com preço e custo) para eu calcular sozinho, ou digite abaixo."}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-suave">CPA máximo (empate)</span>
          <input className={`${campo} w-40`} inputMode="decimal" value={cpa ?? paraInput(eco.cpaMax)} onChange={(e) => setCpa(e.target.value)} />
        </label>
        <button type="button" onClick={() => setAberto((v) => !v)} className={btnSec}>
          {aberto ? "Esconder" : "Ver as regras"}
        </button>
        <button
          type="button"
          disabled={!lista.length || ocupado}
          onClick={async () => {
            setOcupado(true);
            await onCriar(lista);
            setOcupado(false);
            setAberto(false);
          }}
          className={btnPri}
        >
          {ocupado ? "Criando…" : `Usar estas ${lista.length || ""} regras`}
        </button>
      </div>
      {aberto && lista.length > 0 && (
        <ul className="flex flex-col gap-2">
          {lista.map((r) => (
            <li key={r.nome} className="rounded-xl border border-borda bg-fundo p-3 text-sm">
              <ResumoRegra r={r} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-suave">
        As regras entram já ligadas. Elas só agem depois que o Meta estiver conectado e respeitam as travas acima. Você pode editar ou desligar qualquer uma.
      </p>
    </Card>
  );
}

function ResumoRegra({ r }: { r: Pick<Regra, "nome" | "nivel" | "acao" | "valor" | "condicoes" | "periodo" | "alvo" | "so_pausados_por_regra" | "hora_inicio" | "hora_fim" | "frequencia_min"> }) {
  return (
    <div className="flex flex-col gap-1">
      <b>{r.nome}</b>
      <span className="text-suave">
        {descreverAcao(r)} {NOME_NIVEL[r.nivel]} {r.alvo === "pausados" ? (r.so_pausados_por_regra ? "pausados por regra hoje" : "pausados") : "ativos"} quando{" "}
        {r.condicoes.map((c, i) => (
          <span key={i}>
            {i > 0 && " e "}
            <span className="text-texto">
              {NOME_METRICA[c.metrica] ?? c.metrica} {NOME_OP[c.op]} {mostrarValor(UNIDADE[c.metrica] ?? "num", c.valor)}
            </span>
          </span>
        ))}{" "}
        · {NOME_PERIODO[r.periodo].toLowerCase()} · a cada {r.frequencia_min} min
        {r.hora_inicio > 0 || r.hora_fim < 24 ? ` · das ${r.hora_inicio}h às ${r.hora_fim}h` : ""}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editor de regra                                                     */
/* ------------------------------------------------------------------ */

type CondForm = { metrica: string; op: Op; texto: string };

function EditorRegra({ inicial, onSalvar, onCancelar }: { inicial: Regra | null; onSalvar: (r: NovaRegra) => Promise<void>; onCancelar: () => void }) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [nivel, setNivel] = useState<Nivel>(inicial?.nivel ?? "anuncio");
  const [acao, setAcao] = useState<Acao>(inicial?.acao ?? "pausar");
  const [valor, setValor] = useState(inicial?.valor == null ? "20" : inicial.acao === "definir" ? paraInput(inicial.valor) : String(inicial.valor));
  const [alvo, setAlvo] = useState<"ativos" | "pausados">(inicial?.alvo ?? "ativos");
  const [soRegra, setSoRegra] = useState(inicial?.so_pausados_por_regra ?? false);
  const [filtro, setFiltro] = useState(inicial?.filtro_nome ?? "");
  const [periodo, setPeriodo] = useState<Periodo>(inicial?.periodo ?? "hoje");
  const [freq, setFreq] = useState(String(inicial?.frequencia_min ?? 30));
  const [hIni, setHIni] = useState(String(inicial?.hora_inicio ?? 0));
  const [hFim, setHFim] = useState(String(inicial?.hora_fim ?? 24));
  const [limite, setLimite] = useState(String(inicial?.limite_dia ?? 1));
  const [conds, setConds] = useState<CondForm[]>(
    inicial?.condicoes.map((c) => ({ metrica: c.metrica, op: c.op, texto: paraTexto(UNIDADE[c.metrica] ?? "num", c.valor) })) ?? [{ metrica: "gasto", op: "gte", texto: "" }],
  );
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const orcamento = acao === "aumentar" || acao === "diminuir" || acao === "definir";

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!nome.trim()) return setErro("Dê um nome para a regra.");
    if (orcamento && nivel === "anuncio") return setErro("Anúncio não tem orçamento: escolha conjunto ou campanha.");
    const condicoes: Condicao[] = [];
    for (const c of conds) {
      const v = lerValor(UNIDADE[c.metrica] ?? "num", c.texto);
      if (v === null) return setErro(`Preencha o valor de “${NOME_METRICA[c.metrica]}”.`);
      condicoes.push({ metrica: c.metrica, op: c.op, valor: v });
    }
    if (!condicoes.length) return setErro("Coloque pelo menos uma condição.");
    let v: number | null = null;
    if (orcamento) {
      v = acao === "definir" ? paraCentavos(valor) : Math.round(Number(valor));
      if (!v || v <= 0 || (acao !== "definir" && v > 100)) return setErro(acao === "definir" ? "Digite o orçamento em reais." : "Porcentagem entre 1 e 100.");
    }
    const f = Math.max(15, Math.round(Number(freq)) || 30);
    const hi = Math.min(23, Math.max(0, Math.round(Number(hIni)) || 0));
    const hf = Math.min(24, Math.max(hi + 1, Math.round(Number(hFim)) || 24));
    setSalvando(true);
    try {
      await onSalvar({
        nome: nome.trim(),
        ativa: inicial?.ativa ?? true,
        nivel,
        alvo,
        filtro_nome: filtro.trim() || null,
        acao,
        valor: v,
        condicoes,
        periodo,
        frequencia_min: f,
        hora_inicio: hi,
        hora_fim: hf,
        limite_dia: Math.min(10, Math.max(1, Math.round(Number(limite)) || 1)),
        so_pausados_por_regra: alvo === "pausados" && soRegra,
        origem: inicial?.origem ?? "manual",
      });
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const sel = `${inputCls} pr-8`;
  return (
    <form onSubmit={salvar} className="flex flex-col gap-4 rounded-xl border border-limao/40 bg-fundo p-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-suave">Nome da regra</span>
        <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Pausar anúncio sem venda" />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-suave">O que fazer</span>
          <select className={sel} value={acao} onChange={(e) => setAcao(e.target.value as Acao)}>
            <option value="pausar">Pausar</option>
            <option value="ativar">Ativar</option>
            <option value="aumentar">Aumentar orçamento (%)</option>
            <option value="diminuir">Reduzir orçamento (%)</option>
            <option value="definir">Definir orçamento (R$)</option>
          </select>
        </label>
        {orcamento && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-suave">{acao === "definir" ? "Novo orçamento (R$)" : "Quanto (%)"}</span>
            <input className={inputCls} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-suave">Em</span>
          <select className={sel} value={nivel} onChange={(e) => setNivel(e.target.value as Nivel)}>
            <option value="campanha">Campanhas</option>
            <option value="conjunto">Conjuntos</option>
            <option value="anuncio">Anúncios</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-suave">Que estão</span>
          <select className={sel} value={alvo} onChange={(e) => setAlvo(e.target.value as "ativos" | "pausados")}>
            <option value="ativos">Ativos</option>
            <option value="pausados">Pausados</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="text-suave">Só os que têm no nome (opcional)</span>
          <input className={inputCls} value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Ex.: [ESCALA]" />
        </label>
      </div>
      {alvo === "pausados" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={soRegra} onChange={(e) => setSoRegra(e.target.checked)} className="h-4 w-4 accent-[var(--color-limao)]" />
          Só os que uma regra pausou hoje (não reativa o que você pausou na mão)
        </label>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm text-suave">Quando (todas as condições ao mesmo tempo)</span>
        {conds.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              className={`${campo} min-w-0 flex-1 sm:max-w-64 sm:flex-none sm:w-64`}
              value={c.metrica}
              onChange={(e) => setConds((cs) => cs.map((x, j) => (j === i ? { ...x, metrica: e.target.value } : x)))}
              aria-label="Métrica"
            >
              {METRICAS.map((m) => (
                <option key={m.v} value={m.v}>
                  {m.nome}
                </option>
              ))}
            </select>
            <select className={`${campo} w-20`} value={c.op} onChange={(e) => setConds((cs) => cs.map((x, j) => (j === i ? { ...x, op: e.target.value as Op } : x)))} aria-label="Comparação">
              {OPS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.nome}
                </option>
              ))}
            </select>
            <div className="relative w-36">
              <input
                className={`${campo} w-full pr-9`}
                inputMode="decimal"
                value={c.texto}
                onChange={(e) => setConds((cs) => cs.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))}
                aria-label="Valor"
                placeholder="0"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-suave">
                {{ brl: "R$", pct: "%", x: "x", num: "" }[UNIDADE[c.metrica] ?? "num"]}
              </span>
            </div>
            {conds.length > 1 && (
              <button type="button" onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))} className="min-h-11 px-2 text-suave hover:text-vermelho" aria-label="Tirar condição">
                ✕
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setConds((cs) => [...cs, { metrica: "vendas", op: "gte", texto: "" }])} className="self-start text-sm text-limao hover:underline">
          + condição
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="text-suave">Olhando os números de</span>
          <select className={sel} value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
            {PERIODOS.map((p) => (
              <option key={p.v} value={p.v}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-suave">A cada (min)</span>
          <input className={inputCls} inputMode="numeric" value={freq} onChange={(e) => setFreq(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-suave">Das (h)</span>
          <input className={inputCls} inputMode="numeric" value={hIni} onChange={(e) => setHIni(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-suave">Até (h)</span>
          <input className={inputCls} inputMode="numeric" value={hFim} onChange={(e) => setHFim(e.target.value)} />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm sm:w-64">
        <span className="text-suave">Máximo de vezes por item por dia</span>
        <input className={inputCls} inputMode="numeric" value={limite} onChange={(e) => setLimite(e.target.value)} />
      </label>

      {erro && <p className="text-sm text-vermelho">{erro}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={salvando} className={btnPri}>
          {salvando ? "Salvando…" : "Salvar regra"}
        </button>
        <button type="button" onClick={onCancelar} className={btnSec}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Aba Regras                                                          */
/* ------------------------------------------------------------------ */

export function AbaRegras({ conectado }: { conectado: boolean }) {
  const { travas, salvar } = useTravas();
  const [regras, setRegras] = useState<Regra[] | null>(null);
  const [editando, setEditando] = useState<Regra | "nova" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);

  const carregar = useCallback(async () => {
    const { data } = await createClient().from("meta_regras").select("*").order("criado_em");
    setRegras(((data ?? []) as Regra[]).map((r) => ({ ...r, valor: r.valor === null ? null : Number(r.valor) })));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao abrir
    void carregar();
  }, [carregar]);

  async function salvarRegra(r: NovaRegra, id?: string) {
    const supabase = createClient();
    const { error } = id ? await supabase.from("meta_regras").update(r).eq("id", id) : await supabase.from("meta_regras").insert(r);
    if (error) throw new Error("Não consegui salvar a regra.");
    setEditando(null);
    await carregar();
  }

  async function criarVarias(rs: NovaRegra[]) {
    const { error } = await createClient().from("meta_regras").insert(rs);
    setMsg(error ? "Não consegui criar as regras." : `${rs.length} regras criadas e ligadas.`);
    await carregar();
  }

  async function alternar(r: Regra) {
    setRegras((rs) => rs?.map((x) => (x.id === r.id ? { ...x, ativa: !x.ativa } : x)) ?? rs);
    await createClient().from("meta_regras").update({ ativa: !r.ativa }).eq("id", r.id);
  }

  async function apagar(r: Regra) {
    if (!window.confirm(`Apagar a regra “${r.nome}”?`)) return;
    await createClient().from("meta_regras").delete().eq("id", r.id);
    await carregar();
  }

  async function rodarAgora() {
    setMsg(null);
    setRodando(true);
    try {
      const res = await chamarTrafego<{ regras: number; acoes: number }>({ acao: "regras_rodar" });
      setMsg(res.regras === 0 ? "Nenhuma regra estava na hora de rodar (respeitam a frequência e o horário)." : `Rodei ${res.regras} regra(s): ${res.acoes} ação(ões) feitas.`);
      await carregar();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setRodando(false);
    }
  }

  if (!travas || regras === null) return <p className="text-sm text-suave">Carregando…</p>;

  return (
    <>
      {!conectado && (
        <p className="rounded-xl border border-[#5a4220] bg-[#241b0e] px-4 py-3 text-sm text-laranja">
          Você já pode montar as regras, mas elas só começam a agir quando o Meta Ads estiver conectado (aba Relatório).
        </p>
      )}
      <CardTravas key={String(travas.aumento_max_pct) + travas.gasto_min_centavos + travas.teto_diario_centavos} travas={travas} salvar={salvar} />
      <Recomendadas onCriar={criarVarias} jaTem={regras.some((r) => r.origem === "recomendada")} />

      <Card title="Minhas regras">
        <p className="text-sm text-suave">O XClozr confere as regras a cada 15 minutos, puxa os números novos do Meta e age sozinho. Toda ação aparece no sininho e em “Últimas ações”.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setEditando("nova")} className={btnPri}>
            + Nova regra
          </button>
          {conectado && (
            <button type="button" onClick={rodarAgora} disabled={rodando} className={btnSec}>
              {rodando ? "Rodando…" : "▶ Rodar agora"}
            </button>
          )}
        </div>
        {msg && <p className="text-sm text-suave">{msg}</p>}
        {editando === "nova" && <EditorRegra inicial={null} onSalvar={(r) => salvarRegra(r)} onCancelar={() => setEditando(null)} />}
        {regras.length === 0 && editando === null && <p className="text-sm text-suave">Nenhuma regra ainda. Comece pelas recomendadas acima.</p>}
        <ul className="flex flex-col gap-2">
          {regras.map((r) =>
            editando !== "nova" && editando?.id === r.id ? (
              <li key={r.id}>
                <EditorRegra inicial={r} onSalvar={(n) => salvarRegra(n, r.id)} onCancelar={() => setEditando(null)} />
              </li>
            ) : (
              <li key={r.id} className={`flex flex-wrap items-start gap-3 rounded-xl border border-borda bg-fundo p-3 text-sm ${r.ativa ? "" : "opacity-60"}`}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.ativa}
                  aria-label={r.ativa ? "Desligar regra" : "Ligar regra"}
                  onClick={() => void alternar(r)}
                  className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${r.ativa ? "bg-limao" : "bg-borda"}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${r.ativa ? "left-[22px]" : "left-0.5"}`} />
                </button>
                <div className="min-w-0 flex-1">
                  <ResumoRegra r={r} />
                  <span className="text-[11px] text-suave">
                    {r.origem === "recomendada" ? "⭐ recomendada · " : ""}última checagem: {quando(r.ultima_execucao)}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setEditando(r)} className="min-h-9 rounded-lg px-3 text-suave hover:bg-elevado hover:text-texto">
                    Editar
                  </button>
                  <button type="button" onClick={() => void apagar(r)} className="min-h-9 rounded-lg px-3 text-suave hover:bg-elevado hover:text-vermelho">
                    Apagar
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Aba Agente IA                                                       */
/* ------------------------------------------------------------------ */

type Relatorio = { id: string; modo: string; texto: string; revisao_regras: string | null; criado_em: string };
type Sugestao = { id: string; relatorio_id: string; nivel: Nivel; nome: string | null; acao: string; valor: number | null; motivo: string | null; status: string; resultado: string | null };

const MODOS: { v: Travas["agente_modo"]; nome: string; desc: string }[] = [
  { v: "desligado", nome: "Desligado", desc: "Só roda quando você clicar em “Analisar agora”." },
  { v: "recomendar", nome: "Só recomenda", desc: "Todo dia analisa e deixa as sugestões aqui para você aprovar com um clique." },
  { v: "automatico", nome: "Age sozinho", desc: "Todo dia analisa e já aplica o que recomendar, sempre dentro das travas." },
];

const COR_STATUS: Record<string, string> = { aplicada: "text-limao", ignorada: "text-suave", bloqueada: "text-laranja", falhou: "text-vermelho" };

function textoSugestao(s: Sugestao) {
  const a = s.acao === "aumentar" ? `Aumentar orçamento ${s.valor}%` : s.acao === "diminuir" ? `Reduzir orçamento ${s.valor}%` : s.acao === "pausar" ? "Pausar" : "Ativar";
  return `${a} · ${s.nivel === "anuncio" ? "anúncio" : s.nivel} “${s.nome ?? ""}”`;
}

export function AbaAgente({ conectado }: { conectado: boolean }) {
  const { travas, salvar } = useTravas();
  const [temIA, setTemIA] = useState<boolean | null>(null);
  const [rels, setRels] = useState<Relatorio[]>([]);
  const [sugs, setSugs] = useState<Sugestao[]>([]);
  const [analisando, setAnalisando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const supabase = createClient();
    const [ia, r] = await Promise.all([
      supabase.from("ia_config").select("provedor").maybeSingle(),
      supabase.from("agente_relatorios").select("*").order("criado_em", { ascending: false }).limit(10),
    ]);
    setTemIA(Boolean(ia.data));
    const lista = (r.data ?? []) as Relatorio[];
    setRels(lista);
    if (lista.length) {
      const { data } = await supabase.from("agente_sugestoes").select("*").in("relatorio_id", lista.map((x) => x.id)).order("criado_em");
      setSugs(((data ?? []) as Sugestao[]).map((s) => ({ ...s, valor: s.valor === null ? null : Number(s.valor) })));
    } else setSugs([]);
  }, []);
  useEffect(() => {
     
    void carregar();
  }, [carregar]);

  async function analisar() {
    setMsg(null);
    setAnalisando(true);
    try {
      const r = await chamarTrafego<{ sugeridas: number; aplicadas: number }>({ acao: "agente_rodar" });
      setMsg(`Análise pronta: ${r.sugeridas} recomendação(ões)${r.aplicadas ? `, ${r.aplicadas} aplicada(s)` : ""}.`);
      await carregar();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setAnalisando(false);
    }
  }

  async function aplicar(s: Sugestao) {
    setOcupado(s.id);
    try {
      const r = await chamarTrafego<{ texto: string }>({ acao: "aplicar_sugestao", id: s.id });
      setSugs((xs) => xs.map((x) => (x.id === s.id ? { ...x, status: "aplicada", resultado: r.texto } : x)));
    } catch (e) {
      setSugs((xs) => xs.map((x) => (x.id === s.id ? { ...x, status: "bloqueada", resultado: (e as Error).message } : x)));
    } finally {
      setOcupado(null);
    }
  }

  async function ignorar(s: Sugestao) {
    setSugs((xs) => xs.map((x) => (x.id === s.id ? { ...x, status: "ignorada" } : x)));
    await createClient().from("agente_sugestoes").update({ status: "ignorada" }).eq("id", s.id);
  }

  if (!travas || temIA === null) return <p className="text-sm text-suave">Carregando…</p>;

  return (
    <>
      <Card title="🤖 Agente de tráfego">
        <p className="text-sm text-suave">
          Um gestor de tráfego com IA que olha os últimos 7 dias de cada campanha, conjunto e anúncio (gasto, conversas, Pix, vendas e lucro de verdade) e diz o que pausar, o que
          escalar e o que está errado no funil. Usa a mesma IA do menu Agente de IA.
        </p>
        {!temIA && (
          <p className="rounded-xl border border-[#5a4220] bg-[#241b0e] px-4 py-3 text-sm text-laranja">
            Ligue uma IA (OpenAI, Claude ou Gemini) no menu <a href="/ia" className="underline">Agente de IA</a> para o agente funcionar.
          </p>
        )}
        {!conectado && (
          <p className="rounded-xl border border-[#5a4220] bg-[#241b0e] px-4 py-3 text-sm text-laranja">Conecte o Meta Ads (aba Relatório) para o agente ter números para analisar.</p>
        )}
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Modo do agente">
          {MODOS.map((m) => (
            <button
              key={m.v}
              type="button"
              role="radio"
              aria-checked={travas.agente_modo === m.v}
              onClick={() => {
                if (m.v === "automatico" && !window.confirm("No modo “Age sozinho” o agente pausa e muda orçamentos sem te perguntar (sempre dentro das travas). Ligar?")) return;
                void salvar({ agente_modo: m.v }).catch((e) => setMsg((e as Error).message));
              }}
              className={`flex flex-col gap-1 rounded-xl border p-3 text-left text-sm transition ${travas.agente_modo === m.v ? "border-limao bg-limao/10" : "border-borda bg-fundo hover:bg-elevado"}`}
            >
              <b>{m.nome}</b>
              <span className="text-xs text-suave">{m.desc}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {travas.agente_modo !== "desligado" && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-suave">Analisar todo dia às</span>
              <select
                className={`${campo} w-32`}
                value={travas.agente_hora}
                onChange={(e) => void salvar({ agente_hora: Number(e.target.value) }).catch((er) => setMsg((er as Error).message))}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" onClick={analisar} disabled={analisando || !temIA || !conectado} className={btnPri}>
            {analisando ? "Analisando (até 1 min)…" : "Analisar agora"}
          </button>
        </div>
        {travas.emergencia && <p className="text-sm text-vermelho">⛔ As automações estão paradas (botão de emergência na aba Regras). O agente só recomenda.</p>}
        {msg && <p className="text-sm text-suave">{msg}</p>}
      </Card>

      {rels.length === 0 ? (
        <Card>
          <p className="text-sm text-suave">Nenhuma análise ainda.</p>
        </Card>
      ) : (
        rels.map((r, i) => {
          const minhas = sugs.filter((s) => s.relatorio_id === r.id);
          return (
            <Card key={r.id} title={`${i === 0 ? "Última análise" : "Análise"} · ${new Date(r.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}${r.modo === "automatico" ? " · agiu sozinho" : ""}`}>
              <div className="whitespace-pre-line text-sm leading-relaxed">{r.texto}</div>
              {r.revisao_regras && (
                <p className="rounded-xl border border-borda bg-fundo px-4 py-3 text-sm">
                  <b>Sobre suas regras:</b> <span className="text-suave">{r.revisao_regras}</span>
                </p>
              )}
              {minhas.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {minhas.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-borda bg-fundo p-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <b className="block">{textoSugestao(s)}</b>
                        {s.motivo && <span className="text-suave">{s.motivo}</span>}
                        {s.status !== "pendente" && (
                          <span className={`block text-xs ${COR_STATUS[s.status] ?? "text-suave"}`}>
                            {s.status === "aplicada" ? "✓ Aplicada" : s.status === "ignorada" ? "Ignorada" : s.status === "bloqueada" ? "Bloqueada pelas travas" : "Falhou"}
                            {s.resultado ? `: ${s.resultado}` : ""}
                          </span>
                        )}
                      </div>
                      {s.status === "pendente" && (
                        <div className="flex gap-2">
                          <button type="button" onClick={() => void aplicar(s)} disabled={ocupado === s.id} className="min-h-9 rounded-lg bg-limao px-4 text-sm font-bold text-fundo disabled:opacity-60">
                            {ocupado === s.id ? "Aplicando…" : "Aplicar"}
                          </button>
                          <button type="button" onClick={() => void ignorar(s)} className="min-h-9 rounded-lg border border-borda px-3 text-sm hover:bg-elevado">
                            Ignorar
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })
      )}
    </>
  );
}
