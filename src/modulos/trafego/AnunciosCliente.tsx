"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, PageHeader } from "@/components/ui";
import { brl, paraCentavos, paraInput } from "@/lib/dinheiro";
import { AbaAgente, AbaRegras } from "./RegrasAgente";
import { AbaConversoes } from "./Conversoes";
import { ResumoTrafego } from "./Resumo";
import { POR_ID, PersonalizarColunas, somaDe, somar, useColunas } from "./colunas";
import { PERIODOS, chamarTrafego, intervaloDias, relatorio, type Linha, type Nivel, type Periodo, type StatusMeta } from "./api";

const inputCls =
  "w-full min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";
const ABAS: { v: Nivel; nome: string }[] = [
  { v: "campanha", nome: "Campanhas" },
  { v: "conjunto", nome: "Conjuntos" },
  { v: "anuncio", nome: "Anúncios" },
];


function quando(iso: string | null) {
  if (!iso) return "nunca";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "agora há pouco";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/* ------------------------------------------------------------------ */
/* Conectar                                                            */
/* ------------------------------------------------------------------ */

function Conectar({ onConectado }: { onConectado: () => void }) {
  const [token, setToken] = useState("");
  const [estado, setEstado] = useState<"" | "conectando">("");
  const [erro, setErro] = useState<string | null>(null);

  async function conectar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEstado("conectando");
    try {
      await chamarTrafego({ acao: "conectar", token });
      setToken("");
      onConectado();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEstado("");
    }
  }

  return (
    <Card title="Conectar o Meta Ads">
      <p className="text-sm text-suave">
        Com o Meta conectado, o XClozr puxa o gasto de cada campanha, conjunto e anúncio de hora em hora, cruza com as vendas do robô e deixa você pausar ou mudar orçamento por
        aqui.
      </p>
      <ol className="flex flex-col gap-2 rounded-xl border border-borda bg-fundo p-4 text-sm text-suave">
        <li>
          1. Em <b className="text-texto">business.facebook.com</b> → Configurações do negócio → Usuários → <b className="text-texto">Usuários do sistema</b> → Adicionar (função
          Administrador).
        </li>
        <li>
          2. No usuário criado, clique em <b className="text-texto">Atribuir ativos</b> → Contas de anúncios → marque suas contas com <b className="text-texto">controle total</b>.
        </li>
        <li>
          3. Clique em <b className="text-texto">Gerar novo token</b>, escolha seu app (se não tiver, crie um do tipo “Empresa” em developers.facebook.com), validade{" "}
          <b className="text-texto">Nunca expira</b> e marque as permissões <code>ads_management</code>, <code>ads_read</code> e <code>business_management</code>.
        </li>
        <li>4. Copie o token e cole abaixo. Ele fica guardado só no servidor.</li>
      </ol>
      <form onSubmit={conectar} className="flex flex-col gap-3 sm:flex-row">
        <input
          className={inputCls}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Cole o token de acesso (começa com EAA…)"
          autoComplete="off"
          required
        />
        <button type="submit" disabled={estado === "conectando"} className="min-h-11 shrink-0 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60">
          {estado === "conectando" ? "Conectando e puxando 30 dias…" : "Conectar"}
        </button>
      </form>
      {erro && <p className="text-sm text-vermelho">{erro}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Configurações: contas, impostos, desconectar                        */
/* ------------------------------------------------------------------ */

function Configuracoes({ status, onMudou, onFechar }: { status: StatusMeta; onMudou: () => void; onFechar: () => void }) {
  const [contas, setContas] = useState<string[]>(status.escolhidas);
  const [ivenda, setIvenda] = useState("");
  const [imeta, setImeta] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    void createClient()
      .from("configuracoes")
      .select("imposto_venda_pct, imposto_meta_pct")
      .maybeSingle()
      .then(({ data }) => {
        setIvenda(String(data?.imposto_venda_pct ?? 0).replace(".", ","));
        setImeta(String(data?.imposto_meta_pct ?? 0).replace(".", ","));
      });
  }, []);

  async function salvar() {
    setMsg(null);
    setOcupado(true);
    try {
      const supabase = createClient();
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("sem usuário");
      const { error } = await supabase.from("configuracoes").upsert({
        dono_id: u.user.id,
        imposto_venda_pct: Number(ivenda.replace(",", ".")) || 0,
        imposto_meta_pct: Number(imeta.replace(",", ".")) || 0,
      });
      if (error) throw error;
      if (JSON.stringify([...contas].sort()) !== JSON.stringify([...status.escolhidas].sort())) {
        await chamarTrafego({ acao: "escolher_contas", contas });
      }
      setMsg("Salvo.");
      onMudou();
    } catch (e) {
      setMsg((e as Error).message || "Não consegui salvar.");
    } finally {
      setOcupado(false);
    }
  }

  async function desconectar() {
    setOcupado(true);
    await chamarTrafego({ acao: "desconectar" }).catch(() => null);
    setOcupado(false);
    onMudou();
  }

  return (
    <Card title="Configurações do Meta Ads">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-suave">Contas de anúncio acompanhadas</span>
          <ul className="flex flex-col gap-1.5">
            {status.contas.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-[#5ed98c]"
                    checked={contas.includes(c.id)}
                    onChange={(e) => setContas(e.target.checked ? [...contas, c.id] : contas.filter((x) => x !== c.id))}
                  />
                  {c.nome} <span className="text-xs text-suave">({c.id.replace("act_", "")})</span>
                  {c.status !== 1 && <span className="text-xs text-laranja">inativa</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] text-suave">
            Imposto sobre vendas (%)
            <input className={inputCls} inputMode="decimal" value={ivenda} onChange={(e) => setIvenda(e.target.value)} placeholder="Ex.: 6 (Simples) ou 0" />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-suave">
            Imposto sobre o gasto no Meta (%)
            <input className={inputCls} inputMode="decimal" value={imeta} onChange={(e) => setImeta(e.target.value)} placeholder="Ex.: 12,15" />
            <span className="text-[11px]">O Meta cobra impostos em cima do valor dos anúncios no Brasil. Confira na sua fatura e coloque aqui para o lucro bater.</span>
          </label>
          <p className="text-[11px] text-suave">O custo de cada produto você coloca em Produtos e Pix. A taxa do gateway já entra sozinha.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={ocupado} onClick={salvar} className="min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo disabled:opacity-60">
          {ocupado ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" onClick={onFechar} className="min-h-11 rounded-[10px] border border-borda bg-cartao px-4 text-sm">
          Fechar
        </button>
        <button type="button" disabled={ocupado} onClick={desconectar} className="ml-auto min-h-11 rounded-[10px] px-4 text-sm text-suave hover:text-vermelho">
          Desconectar Meta
        </button>
        {msg && <span className="w-full text-sm text-suave">{msg}</span>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Tabela                                                              */
/* ------------------------------------------------------------------ */

function Interruptor({ ligado, ocupado, onClick, rotulo }: { ligado: boolean; ocupado: boolean; onClick: () => void; rotulo: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={ocupado}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${ligado ? "bg-limao" : "bg-elevado"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${ligado ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function Orcamento({ linha, nivel, onSalvar }: { linha: Linha; nivel: Nivel; onSalvar: (centavos: number) => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  if (nivel === "anuncio" || !linha.orcamento_diario) return <span className="text-suave">{nivel === "anuncio" ? "—" : "no outro nível"}</span>;
  if (!editando)
    return (
      <button
        type="button"
        onClick={() => {
          setValor(paraInput(linha.orcamento_diario));
          setEditando(true);
        }}
        className="rounded-md px-1.5 py-0.5 text-left underline decoration-dotted underline-offset-4 hover:bg-elevado"
        title="Clique para mudar o orçamento diário"
      >
        {brl(linha.orcamento_diario)}/dia
      </button>
    );
  async function salvar() {
    const c = paraCentavos(valor);
    if (!c || c < 100) return;
    const atual = linha.orcamento_diario ?? 0;
    if (atual && c > atual * 1.5 && !window.confirm(`Aumentar de ${brl(atual)} para ${brl(c)} (+${Math.round((c / atual - 1) * 100)}%)? Aumentos grandes costumam reiniciar o aprendizado.`)) return;
    setSalvando(true);
    try {
      await onSalvar(c);
      setEditando(false);
    } finally {
      setSalvando(false);
    }
  }
  return (
    <span className="flex items-center gap-1">
      <input
        autoFocus
        inputMode="decimal"
        aria-label="Novo orçamento diário"
        className="h-8 w-24 rounded-md border border-limao bg-fundo px-2 text-sm"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void salvar();
          if (e.key === "Escape") setEditando(false);
        }}
      />
      <button type="button" disabled={salvando} onClick={salvar} className="h-8 rounded-md bg-limao px-2 text-xs font-bold text-fundo disabled:opacity-60">
        {salvando ? "…" : "OK"}
      </button>
    </span>
  );
}

type Aba = "relatorio" | "regras" | "agente" | "conversoes";
const ABAS_PAGINA: { v: Aba; nome: string }[] = [
  { v: "relatorio", nome: "📊 Relatório" },
  { v: "regras", nome: "⚡ Regras automáticas" },
  { v: "agente", nome: "🤖 Agente IA" },
  { v: "conversoes", nome: "📡 API de Conversões" },
];

export function AnunciosCliente() {
  const [aba, setAba] = useState<Aba>("relatorio");
  const { ids: colunasIds, salvar: salvarColunas } = useColunas();
  const [personalizar, setPersonalizar] = useState(false);
  const [ordem, setOrdem] = useState<{ id: string; asc: boolean } | null>(null);
  const [status, setStatus] = useState<StatusMeta | null>(null);
  const [config, setConfig] = useState(false);
  const [nivel, setNivel] = useState<Nivel>("campanha");
  const [periodo, setPeriodo] = useState<Periodo>("hoje");
  const [conta, setConta] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"" | "ativos" | "pausados">("");
  const [sel, setSel] = useState<Record<Nivel, string[]>>({ campanha: [], conjunto: [], anuncio: [] });
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [campanhas, setCampanhas] = useState<Linha[] | null>(null);
  const [emMassa, setEmMassa] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [acoes, setAcoes] = useState<{ id: number; nome: string; acao: string; de: string; para: string; origem: string; ok: boolean; erro: string | null; motivo: string | null; criado_em: string }[]>([]);

  const carregarStatus = useCallback(async () => {
    try {
      setStatus(await chamarTrafego<StatusMeta>({ acao: "status" }));
    } catch (e) {
      setErro((e as Error).message);
      setStatus({ conectado: false, usuario: null, escolhidas: [], contas: [], ultimo_sync: null, erro: null });
    }
  }, []);

  const carregarDados = useCallback(async () => {
    const [ini, fim] = intervaloDias(periodo);
    try {
      const [ls, cs] = await Promise.all([relatorio(nivel, ini, fim, conta || null), nivel === "campanha" ? null : relatorio("campanha", ini, fim, conta || null)]);
      setLinhas(ls);
      setCampanhas(cs ?? ls);
    } catch {
      setErro("Não consegui carregar o relatório.");
    }
    const { data } = await createClient().from("meta_acoes").select("id, nome, acao, de, para, origem, ok, erro, motivo, criado_em").order("criado_em", { ascending: false }).limit(8);
    setAcoes((data ?? []) as typeof acoes);
  }, [nivel, periodo, conta]);

  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("aba");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- aba vinda do link (?aba=agente)
    if (a === "regras" || a === "agente" || a === "conversoes") setAba(a);
  }, []);

  function trocarAba(a: Aba) {
    setAba(a);
    const u = new URL(window.location.href);
    if (a === "relatorio") u.searchParams.delete("aba");
    else u.searchParams.set("aba", a);
    window.history.replaceState(null, "", u);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao abrir a página
    void carregarStatus();
  }, [carregarStatus]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recarrega ao trocar nível/período/conta
    if (status?.conectado) void carregarDados();
  }, [status?.conectado, carregarDados]);

  async function sincronizar() {
    setErro(null);
    setSincronizando(true);
    try {
      await chamarTrafego({ acao: "sincronizar" });
      await carregarStatus();
      await carregarDados();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSincronizando(false);
    }
  }

  async function agir(l: Linha, tipo: "pausar" | "ativar" | "orcamento", valor?: number, recarregar = true) {
    setErro(null);
    setOcupado(l.id);
    const antes = linhas;
    setLinhas((ls) =>
      ls?.map((x) =>
        x.id !== l.id ? x : tipo === "orcamento" ? { ...x, orcamento_diario: valor ?? x.orcamento_diario } : { ...x, status: tipo === "pausar" ? "PAUSED" : "ACTIVE" },
      ) ?? ls,
    );
    try {
      await chamarTrafego({ acao: "agir", nivel, id: l.id, tipo, valor_centavos: valor });
      if (recarregar) void carregarDados();
    } catch (e) {
      setLinhas(antes);
      setErro(`${l.nome}: ${(e as Error).message}`);
    } finally {
      setOcupado(null);
    }
  }

  const passaStatus = useCallback((l: Linha) => !filtroStatus || (filtroStatus === "ativos" ? l.status === "ACTIVE" : l.status !== "ACTIVE"), [filtroStatus]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const sc = new Set(sel.campanha);
    const sj = new Set(sel.conjunto);
    return (linhas ?? []).filter((l) => {
      if (q && !l.nome.toLowerCase().includes(q)) return false;
      if (!passaStatus(l)) return false;
      if (nivel === "conjunto" && sc.size && !sc.has(l.campanha_id)) return false;
      if (nivel === "anuncio") {
        if (sj.size) return sj.has(l.conjunto_id ?? "");
        if (sc.size && !sc.has(l.campanha_id)) return false;
      }
      return true;
    });
  }, [linhas, busca, passaStatus, sel, nivel]);

  /** Campanhas que entram no resumo: as marcadas (ou todas que passam nos filtros). */
  const campanhasResumo = useMemo(() => {
    const cs = campanhas ?? [];
    if (sel.campanha.length) return cs.filter((c) => sel.campanha.includes(c.id));
    const q = busca.trim().toLowerCase();
    return cs.filter((c) => passaStatus(c) && (nivel !== "campanha" || !q || c.nome.toLowerCase().includes(q)));
  }, [campanhas, sel.campanha, busca, passaStatus, nivel]);

  const marcados = sel[nivel];
  const todosMarcados = visiveis.length > 0 && visiveis.every((l) => marcados.includes(l.id));

  function aplicarSelecao(x: Record<Nivel, string[]>, lista: string[]): Record<Nivel, string[]> {
    // mudou as campanhas marcadas: os conjuntos/anúncios marcados de antes deixam de valer
    if (nivel === "campanha") return { campanha: lista, conjunto: [], anuncio: [] };
    if (nivel === "conjunto") return { ...x, conjunto: lista, anuncio: [] };
    return { ...x, anuncio: lista };
  }
  function marcar(id: string, sim: boolean) {
    setSel((x) => aplicarSelecao(x, sim ? [...new Set([...x[nivel], id])] : x[nivel].filter((i) => i !== id)));
  }
  function marcarTodos(sim: boolean) {
    const ids = new Set(visiveis.map((l) => l.id));
    setSel((x) => aplicarSelecao(x, sim ? [...new Set([...x[nivel], ...ids])] : x[nivel].filter((i) => !ids.has(i))));
  }
  function limpar(n: Nivel) {
    setSel((x) => (n === "campanha" ? { campanha: [], conjunto: [], anuncio: [] } : n === "conjunto" ? { ...x, conjunto: [], anuncio: [] } : { ...x, anuncio: [] }));
  }

  async function emMassaAgir(tipo: "pausar" | "ativar") {
    const alvo = visiveis.filter((l) => marcados.includes(l.id) && (tipo === "pausar" ? l.status === "ACTIVE" : l.status !== "ACTIVE"));
    const nomeNivel = ABAS.find((a) => a.v === nivel)!.nome.toLowerCase();
    if (!alvo.length) {
      setErro(`Nenhum dos marcados está ${tipo === "pausar" ? "ativo" : "pausado"}.`);
      return;
    }
    if (!window.confirm(`${tipo === "pausar" ? "Pausar" : "Ativar"} ${alvo.length} ${nomeNivel} no Meta?`)) return;
    setEmMassa(true);
    for (const l of alvo) await agir(l, tipo, undefined, false);
    setEmMassa(false);
    void carregarDados();
  }

  function linkGerenciador() {
    const contaId = (conta || status?.escolhidas[0] || "").replace("act_", "");
    const u = new URL(`https://adsmanager.facebook.com/adsmanager/manage/${nivel === "campanha" ? "campaigns" : nivel === "conjunto" ? "adsets" : "ads"}`);
    if (contaId) u.searchParams.set("act", contaId);
    if (sel.campanha.length) u.searchParams.set("selected_campaign_ids", sel.campanha.join(","));
    if (sel.conjunto.length) u.searchParams.set("selected_adset_ids", sel.conjunto.join(","));
    return u.toString();
  }

  const total = useMemo(() => somar(visiveis), [visiveis]);
  const cols = useMemo(() => colunasIds.map((id) => POR_ID.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c)), [colunasIds]);
  const ordenadas = useMemo(() => {
    if (!ordem) return visiveis;
    const c = POR_ID.get(ordem.id);
    if (!c) return visiveis;
    return [...visiveis].sort((x, y) => {
      const a = c.valor(somaDe(x));
      const b = c.valor(somaDe(y));
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return ordem.asc ? a - b : b - a;
    });
  }, [visiveis, ordem]);

  function ordenar(id: string) {
    setOrdem((o) => (o?.id !== id ? { id, asc: false } : o.asc ? null : { id, asc: true }));
  }

  /** Clicar no nome: marca só ele e abre o nível de baixo. */
  function abrir(l: Linha) {
    if (nivel === "campanha") {
      setSel({ campanha: [l.id], conjunto: [], anuncio: [] });
      setNivel("conjunto");
    } else if (nivel === "conjunto") {
      setSel((x) => ({ ...x, conjunto: [l.id], anuncio: [] }));
      setNivel("anuncio");
    }
  }

  if (status === null) return <PageHeader title="Anúncios" subtitle="Carregando…" />;

  return (
    <>
      <PageHeader
        title="Anúncios"
        subtitle={status.conectado ? `Meta Ads de ${status.usuario ?? "sua conta"}` : "Conecte o Meta Ads para ver gasto, vendas e lucro de cada anúncio"}
      />

      <div className="flex flex-wrap gap-1 rounded-xl border border-borda bg-cartao p-1 self-start" role="tablist" aria-label="Seções de anúncios">
        {ABAS_PAGINA.map((a) => (
          <button
            key={a.v}
            type="button"
            role="tab"
            aria-selected={aba === a.v}
            onClick={() => trocarAba(a.v)}
            className={`min-h-10 rounded-lg px-4 text-sm transition ${aba === a.v ? "bg-limao font-bold text-fundo" : "text-suave hover:bg-elevado hover:text-texto"}`}
          >
            {a.nome}
          </button>
        ))}
      </div>

      {aba === "regras" && <AbaRegras conectado={status.conectado} />}
      {aba === "agente" && <AbaAgente conectado={status.conectado} />}
      {aba === "conversoes" && <AbaConversoes />}

      {aba === "relatorio" && erro && <p className="text-sm text-vermelho">{erro}</p>}
      {aba === "relatorio" && status.erro && (
        <p className="rounded-xl border border-[#5a4220] bg-[#241b0e] px-4 py-3 text-sm text-laranja">Última atualização com erro: {status.erro}</p>
      )}

      {aba === "relatorio" && !status.conectado && <Conectar onConectado={() => void carregarStatus()} />}

      {aba === "relatorio" && status.conectado && config && (
        <Configuracoes
          status={status}
          onFechar={() => setConfig(false)}
          onMudou={() => {
            void carregarStatus();
            void carregarDados();
          }}
        />
      )}

      {aba === "relatorio" && status.conectado && (
        <>
          {/* Resumo */}
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">Resumo</h2>
            {sel.campanha.length > 0 && (
              <span className="rounded-full bg-elevado px-2.5 py-0.5 text-xs text-suave">
                das {sel.campanha.length} campanha{sel.campanha.length > 1 ? "s" : ""} marcada{sel.campanha.length > 1 ? "s" : ""}
              </span>
            )}
            <span className="ml-auto text-xs text-suave">Atualizado {quando(status.ultimo_sync)}</span>
            <button
              type="button"
              onClick={sincronizar}
              disabled={sincronizando}
              className="min-h-10 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60"
            >
              {sincronizando ? "Atualizando…" : "Atualizar"}
            </button>
          </div>
          {campanhas === null ? <p className="text-sm text-suave">Carregando…</p> : <ResumoTrafego campanhas={campanhasResumo} />}

          <Card>
            {/* abas por nível, com a seleção */}
            <div className="-mx-1 flex flex-wrap items-end gap-1 border-b border-borda" role="tablist" aria-label="Nível">
              {ABAS.map((a) => {
                const ativa = nivel === a.v;
                const pai = a.v === "conjunto" ? sel.campanha : a.v === "anuncio" ? (sel.conjunto.length ? sel.conjunto : sel.campanha) : [];
                const doQue = a.v === "anuncio" && sel.conjunto.length ? "conjunto" : "campanha";
                const rotulo = pai.length ? `${a.nome} para ${pai.length} ${doQue}${pai.length > 1 ? "s" : ""}` : a.nome;
                return (
                  <div key={a.v} className={`flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 ${ativa ? "border-limao" : "border-transparent"}`}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={ativa}
                      onClick={() => setNivel(a.v)}
                      className={`text-sm ${ativa ? "font-semibold text-limao" : "text-suave hover:text-texto"}`}
                    >
                      {a.v === "campanha" ? "📁 " : a.v === "conjunto" ? "▦ " : "▢ "}
                      {rotulo}
                    </button>
                    {sel[a.v].length > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-limao px-2.5 py-0.5 text-xs font-bold text-fundo">
                        {sel[a.v].length} selecionado{sel[a.v].length > 1 ? "s" : ""}
                        <button type="button" onClick={() => limpar(a.v)} aria-label={`Limpar seleção de ${a.nome.toLowerCase()}`} className="ml-0.5 hover:opacity-70">
                          ✕
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* barra de ações */}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setConfig((v) => !v)} aria-label="Configurações do Meta Ads" title="Contas e impostos" className="min-h-10 rounded-[10px] border border-borda bg-fundo px-3 text-sm hover:bg-elevado">
                ⚙
              </button>
              <a href={linkGerenciador()} target="_blank" rel="noreferrer" className="flex min-h-10 items-center rounded-[10px] border border-borda bg-fundo px-4 text-sm hover:bg-elevado">
                ↗ Abrir no Gerenciador
              </a>
              <button type="button" onClick={() => setPersonalizar(true)} className="min-h-10 rounded-[10px] border border-borda bg-fundo px-4 text-sm hover:bg-elevado">
                ▦ Colunas
              </button>
              {marcados.length > 0 && (
                <>
                  <span className="mx-1 h-6 w-px bg-borda" aria-hidden />
                  <button type="button" disabled={emMassa} onClick={() => void emMassaAgir("pausar")} className="min-h-10 rounded-[10px] border border-borda bg-fundo px-4 text-sm hover:border-vermelho/60 hover:text-vermelho disabled:opacity-60">
                    ⏸ Pausar marcados
                  </button>
                  <button type="button" disabled={emMassa} onClick={() => void emMassaAgir("ativar")} className="min-h-10 rounded-[10px] border border-borda bg-fundo px-4 text-sm hover:border-limao/60 hover:text-limao disabled:opacity-60">
                    ▶ Ativar marcados
                  </button>
                  {emMassa && <span className="text-xs text-suave">Aplicando no Meta…</span>}
                </>
              )}
            </div>
            {personalizar && <PersonalizarColunas ids={colunasIds} onSalvar={(ids) => void salvarColunas(ids)} onFechar={() => setPersonalizar(false)} />}

            {/* filtros */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1.5 text-[13px] text-suave">
                Nome {nivel === "campanha" ? "da campanha" : nivel === "conjunto" ? "do conjunto" : "do anúncio"}
                <input className={inputCls} placeholder="Filtrar por nome" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] text-suave">
                Status
                <select className={inputCls} value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)}>
                  <option value="">Qualquer</option>
                  <option value="ativos">Ativos</option>
                  <option value="pausados">Pausados</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] text-suave">
                Período
                <select className={inputCls} value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
                  {PERIODOS.map((p) => (
                    <option key={p.v} value={p.v}>
                      {p.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] text-suave">
                Conta de anúncio
                <select className={inputCls} value={conta} onChange={(e) => setConta(e.target.value)}>
                  <option value="">Todas</option>
                  {status.contas
                    .filter((c) => status.escolhidas.includes(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <div className="max-h-[70vh] overflow-auto rounded-xl border border-borda">
              <table className="w-full whitespace-nowrap text-sm">
                <thead className="sticky top-0 z-10 bg-elevado">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-suave">
                    <th className="w-12 py-3 pl-4 pr-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#5ed98c]"
                        aria-label="Marcar todos"
                        checked={todosMarcados}
                        onChange={(e) => marcarTodos(e.target.checked)}
                      />
                    </th>
                    <th className="py-3 pr-4 font-semibold">Status</th>
                    <th className="py-3 pr-4 font-semibold">{ABAS.find((a) => a.v === nivel)?.nome.slice(0, -1)}</th>
                    {cols.map((c) => (
                      <th key={c.id} className={`py-3 pr-3 font-semibold ${c.id === "orcamento" ? "" : "text-right"}`} title={c.desc} aria-sort={ordem?.id === c.id ? (ordem.asc ? "ascending" : "descending") : undefined}>
                        {c.id === "orcamento" ? (
                          c.nome
                        ) : (
                          <button type="button" onClick={() => ordenar(c.id)} className="uppercase hover:text-texto">
                            {c.nome}
                            {ordem?.id === c.id ? (ordem.asc ? " ↑" : " ↓") : ""}
                          </button>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-borda">
                  {linhas === null && (
                    <tr>
                      <td colSpan={cols.length + 3} className="py-6 text-center text-suave">
                        Carregando…
                      </td>
                    </tr>
                  )}
                  {linhas && visiveis.length === 0 && (
                    <tr>
                      <td colSpan={cols.length + 3} className="py-8 text-center text-suave">
                        Nada por aqui com esses filtros. Se você acabou de conectar, clique em “Atualizar”.
                      </td>
                    </tr>
                  )}
                  {ordenadas.map((l) => {
                    const ativo = l.status === "ACTIVE";
                    const sl = somaDe(l);
                    const marcado = marcados.includes(l.id);
                    return (
                      <tr key={l.id} className={marcado ? "bg-limao/5" : "hover:bg-elevado/40"}>
                        <td className="py-2.5 pl-4 pr-3">
                          <input type="checkbox" className="h-4 w-4 accent-[#5ed98c]" aria-label={`Marcar ${l.nome}`} checked={marcado} onChange={(e) => marcar(l.id, e.target.checked)} />
                        </td>
                        <td className="py-2.5 pr-4">
                          <Interruptor ligado={ativo} ocupado={ocupado === l.id || emMassa} rotulo={`${ativo ? "Pausar" : "Ativar"} ${l.nome}`} onClick={() => agir(l, ativo ? "pausar" : "ativar")} />
                        </td>
                        <td className="max-w-[320px] py-2.5 pr-4">
                          {nivel !== "anuncio" ? (
                            <button type="button" onClick={() => abrir(l)} className="block truncate text-left font-medium hover:text-limao" title={`Ver ${nivel === "campanha" ? "conjuntos" : "anúncios"} de ${l.nome}`}>
                              {l.nome}
                            </button>
                          ) : (
                            <span className="flex items-center gap-2">
                              <span className="block truncate font-medium" title={l.nome}>
                                {l.nome}
                              </span>
                              <a
                                href={`/disparos?anuncio=${encodeURIComponent(l.id)}`}
                                className="shrink-0 rounded-md border border-borda px-1.5 py-0.5 text-[11px] text-suave hover:border-limao/50 hover:text-limao"
                                title="Montar um disparo para quem veio deste anúncio e não comprou"
                              >
                                📣 Recuperar
                              </a>
                            </span>
                          )}
                          {l.status_efetivo && l.status_efetivo !== l.status && l.status_efetivo !== "ACTIVE" && (
                            <span className="text-[11px] text-laranja">{l.status_efetivo.toLowerCase().replaceAll("_", " ")}</span>
                          )}
                        </td>
                        {cols.map((c) => {
                          if (c.id === "orcamento")
                            return (
                              <td key={c.id} className="py-2.5 pr-3">
                                <Orcamento linha={l} nivel={nivel} onSalvar={(v) => agir(l, "orcamento", v)} />
                              </td>
                            );
                          const v = c.valor(sl);
                          return (
                            <td key={c.id} className={`py-2.5 pr-3 text-right tabular-nums ${c.cor?.(v, sl) ?? ""}`}>
                              {c.texto(v)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 bg-elevado font-semibold">
                  <tr>
                    <td className="py-3 pl-4 pr-3" />
                    <td className="py-3 pr-4" />
                    <td className="py-3 pr-4 uppercase">
                      {visiveis.length} {ABAS.find((a) => a.v === nivel)?.nome.toLowerCase()}
                    </td>
                    {cols.map((c) => {
                      if (c.id === "orcamento") return <td key={c.id} className="py-3 pr-3 text-xs text-suave">—</td>;
                      const v = c.valor(total);
                      return (
                        <td key={c.id} className={`py-3 pr-3 text-right tabular-nums ${c.cor?.(v, total) ?? ""}`}>
                          {c.texto(v)}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-[11px] text-suave">
              Marque campanhas para ver só os conjuntos e anúncios delas (e o resumo lá em cima passa a ser só delas). Clicar no nome abre direto o nível de baixo. Contatos e vendas vêm do
              robô; o lucro desconta gasto, imposto do Meta, taxa do gateway, imposto sobre venda e custo do produto.
            </p>
          </Card>
        </>
      )}

      {aba === "relatorio" && status.conectado && acoes.length > 0 && (
        <Card title="Últimas ações">
          <ul className="flex flex-col divide-y divide-borda text-sm">
            {acoes.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className={a.ok ? "text-limao" : "text-vermelho"}>{a.ok ? "✓" : "✕"}</span>
                <span className="font-medium">{a.nome}</span>
                <span className="text-suave">
                  {a.acao === "orcamento" ? `orçamento ${brl(Number(a.de))} → ${brl(Number(a.para))}` : a.acao === "pausar" ? "pausado" : "ativado"}
                  {a.motivo ? ` (${a.motivo})` : a.origem === "regra" ? " (regra automática)" : ""}
                  {!a.ok && a.erro ? ` — ${a.erro}` : ""}
                </span>
                <span className="ml-auto text-xs text-suave">{quando(a.criado_em)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
