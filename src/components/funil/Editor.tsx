"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { BLOCOS, GRUPOS, blocoDe, type Config, type TipoBloco } from "@/lib/funil/blocos";
import { criarNo, limparLigacoes, novoId, paraSalvar, type Grafo, type NoBloco } from "@/lib/funil/grafo";
import { BlocoNode, IconeBloco } from "./BlocoNode";
import { OpcoesCrmContext, PainelConfig, type Opcao, type OpcoesCrm } from "./PainelConfig";
import { validarFunil, type Problema } from "@/lib/funil/validar";
import { Simulador, type ChamarSimulador } from "./Simulador";
import { carregarDesempenho, DesempenhoContext, pct, type Desempenho } from "@/lib/funil/desempenho";

const nodeTypes: NodeTypes = { bloco: BlocoNode };
const TIPO_ARRASTE = "application/xclozr-bloco";

export type DadosFunil = { nome: string; ativo: boolean; grafo: Grafo };

type Props = {
  inicial: DadosFunil;
  produtos: Opcao[];
  funis: Opcao[];
  crm?: OpcoesCrm;
  onSalvar: (dados: DadosFunil) => Promise<void>;
  simular?: ChamarSimulador;
  funilId?: string;
};

function Paleta({ onAdicionar }: { onAdicionar: (tipo: TipoBloco) => void }) {
  const onDragStart = (e: DragEvent, tipo: TipoBloco) => {
    e.dataTransfer.setData(TIPO_ARRASTE, tipo);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <nav aria-label="Blocos" className="flex shrink-0 gap-4 overflow-x-auto border-b border-borda bg-lateral p-3 md:w-56 md:flex-col md:overflow-y-auto md:border-r md:border-b-0">
      {GRUPOS.map((g) => (
        <div key={g.id} className="flex shrink-0 flex-col gap-1">
          <span className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-suave uppercase">{g.nome}</span>
          <div className="flex gap-1 md:flex-col">
            {Object.values(BLOCOS)
              .filter((b) => b.grupo === g.id)
              .map((b) => (
                <button
                  key={b.tipo}
                  type="button"
                  draggable
                  onDragStart={(e) => onDragStart(e, b.tipo)}
                  onClick={() => onAdicionar(b.tipo)}
                  title={b.descricao}
                  className="flex min-h-10 shrink-0 cursor-grab items-center gap-2.5 rounded-lg px-2 text-left text-[13px] font-medium text-texto hover:bg-elevado active:cursor-grabbing"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: `${b.cor}22` }}>
                    <IconeBloco path={b.icone} cor={b.cor} tamanho={15} />
                  </span>
                  {b.nome}
                </button>
              ))}
          </div>
        </div>
      ))}
      <p className="hidden px-2 pt-2 text-[11px] leading-relaxed text-suave md:block">
        Com um bloco selecionado, clicar aqui já cria o próximo ligado nele. Ou arraste para o quadro e ligue as bolinhas da direita na entrada do próximo bloco.
      </p>
    </nav>
  );
}

function EditorInterno({ inicial, produtos, funis, onSalvar, simular, funilId }: Omit<Props, "crm">) {
  const [testando, setTestando] = useState(false);
  const [verDesempenho, setVerDesempenho] = useState(false);
  const [dias, setDias] = useState<number | null>(30);
  const [desempenho, setDesempenho] = useState<Desempenho | null>(null);
  const [carregandoDes, setCarregandoDes] = useState(false);
  const [erroDes, setErroDes] = useState<string | null>(null);
  const [recarregarDes, setRecarregarDes] = useState(0);
  const [blocoTeste, setBlocoTeste] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<NoBloco>(inicial.grafo.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(inicial.grafo.edges);
  const [nome, setNome] = useState(inicial.nome);
  const [ativo, setAtivo] = useState(inicial.ativo);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [status, setStatus] = useState<"salvo" | "pendente" | "salvando" | "erro">("salvo");
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [verProblemas, setVerProblemas] = useState(false);
  const [pedindoAtivar, setPedindoAtivar] = useState(false);
  const quadro = useRef<HTMLDivElement>(null);

  // ---------- salvamento automático ----------
  const ultimoSalvo = useRef(JSON.stringify({ nome: inicial.nome, ativo: inicial.ativo, grafo: paraSalvar(inicial.grafo.nodes, inicial.grafo.edges) }));
  const atual = useMemo(() => ({ nome, ativo, grafo: paraSalvar(nodes, edges) }), [nome, ativo, nodes, edges]);
  const atualStr = JSON.stringify(atual);

  useEffect(() => {
    if (atualStr === ultimoSalvo.current) return;
    setStatus("pendente");
    const t = setTimeout(async () => {
      setStatus("salvando");
      try {
        await onSalvar(JSON.parse(atualStr) as DadosFunil);
        ultimoSalvo.current = atualStr;
        setStatus("salvo");
      } catch {
        setStatus("erro");
      }
    }, 900);
    return () => clearTimeout(t);
  }, [atualStr, onSalvar]);

  // ---------- adicionar blocos ----------
  /** Acha um lugar livre perto da posição desejada (desce até não encostar em outro bloco). */
  const lugarLivre = useCallback(
    (desejado: { x: number; y: number }) => {
      const pos = { ...desejado };
      const ocupado = (p: { x: number; y: number }) =>
        nodes.some((n) => Math.abs(n.position.x - p.x) < 270 && Math.abs(n.position.y - p.y) < 150);
      for (let i = 0; i < 30 && ocupado(pos); i++) pos.y += 170;
      return pos;
    },
    [nodes],
  );

  const adicionar = useCallback(
    (tipo: TipoBloco, posicao?: { x: number; y: number }) => {
      // origem: o bloco selecionado; num funil novo, o Início (se ainda não estiver ligado)
      const inicioLivre = !edges.some((e) => e.source === "inicio");
      const origem = posicao
        ? undefined
        : (selecionado ? nodes.find((n) => n.id === selecionado) : undefined) ??
          (inicioLivre ? nodes.find((n) => n.id === "inicio") : undefined);
      let pos = posicao;
      let ligarDe: { source: string; sourceHandle: string } | null = null;

      if (!pos && origem) {
        // entra ao lado do bloco selecionado, ligado na primeira saída livre dele
        pos = lugarLivre({ x: origem.position.x + 340, y: origem.position.y });
        const livre = blocoDe(origem.data.tipo)
          .saidas(origem.data.config)
          .find((s) => !edges.some((e) => e.source === origem.id && e.sourceHandle === s.id));
        if (livre) ligarDe = { source: origem.id, sourceHandle: livre.id };
      } else if (!pos) {
        const r = quadro.current?.getBoundingClientRect();
        const centro = r ? { x: r.left + r.width / 2, y: r.top + r.height / 3 } : { x: 400, y: 300 };
        const p = screenToFlowPosition(centro);
        pos = lugarLivre({ x: p.x - 128, y: p.y - 60 });
      }

      const no = criarNo(tipo, pos);
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...no, selected: true }]);
      if (ligarDe) setEdges((es) => [...es, { id: `e_${novoId()}`, ...ligarDe, target: no.id, targetHandle: null }]);
      setSelecionado(no.id);
    },
    [screenToFlowPosition, setNodes, setEdges, selecionado, nodes, edges, lugarLivre],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const tipo = e.dataTransfer.getData(TIPO_ARRASTE) as TipoBloco;
      if (!tipo || !(tipo in BLOCOS)) return;
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      adicionar(tipo, { x: p.x - 128, y: p.y - 30 });
    },
    [adicionar, screenToFlowPosition],
  );

  // ---------- ligações: cada saída liga em um só bloco ----------
  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source === c.target) return;
      setEdges((es) =>
        addEdge(
          { ...c, id: `e_${novoId()}` },
          es.filter((e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null))),
        ),
      );
    },
    [setEdges],
  );

  // ---------- checagem do funil ----------
  const problemas = useMemo(() => validarFunil(nodes, edges, produtos, funis), [nodes, edges, produtos, funis]);
  const graves = problemas.filter((x) => x.nivel === "grave");
  const porBloco = useMemo(() => {
    const m = new Map<string, Problema["nivel"]>();
    for (const x of problemas) if (m.get(x.blocoId) !== "grave") m.set(x.blocoId, x.nivel);
    return m;
  }, [problemas]);

  // "Onde desistem": carrega o desempenho real do funil
  const inicioId = useMemo(() => nodes.find((n) => n.data.tipo === "inicio")?.id, [nodes]);
  const abBlocosChave = useMemo(
    () =>
      nodes
        .filter((n) => n.data.tipo === "randomizador")
        .map((n) => n.id)
        .join(","),
    [nodes],
  );
  useEffect(() => {
    if (!verDesempenho || !funilId) return;
    let vivo = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mostra o carregamento ao abrir/trocar o período
    setCarregandoDes(true);
    setErroDes(null);
    carregarDesempenho(funilId, dias, inicioId, abBlocosChave ? abBlocosChave.split(",") : [])
      .then((d) => vivo && setDesempenho(d))
      .catch((e) => vivo && setErroDes((e as Error).message))
      .finally(() => vivo && setCarregandoDes(false));
    return () => {
      vivo = false;
    };
  }, [verDesempenho, funilId, dias, inicioId, abBlocosChave, recarregarDes]);
  const desempenhoVisivel = verDesempenho ? desempenho : null;
  const maioresPerdas = useMemo(() => {
    if (!desempenhoVisivel) return [];
    return nodes
      .map((n) => {
        const b = desempenhoVisivel.blocos[n.id];
        const semResposta = blocoDe(n.data.tipo)
          .saidas(n.data.config)
          .filter((x) => ["sem_resposta", "nao_pagou", "expirou", "recusou"].includes(x.id) && !(n.data.tipo === "orderbump" && x.id === "recusou"))
          .reduce((t, x) => t + (desempenhoVisivel.saidas[`${n.id}|${x.id}`] ?? 0), 0);
        return { id: n.id, nome: blocoDe(n.data.tipo).nome, resumo: blocoDe(n.data.tipo).resumo(n.data.config), perdidos: (b?.parados ?? 0) + semResposta };
      })
      .filter((x) => x.perdidos > 0)
      .sort((a, b) => b.perdidos - a.perdidos)
      .slice(0, 3);
  }, [desempenhoVisivel, nodes]);

  // no teste, destaca o bloco onde a conversa está
  const nodesExibidos = useMemo(
    () =>
      nodes.map((n) => {
        if (testando && n.id === blocoTeste) return { ...n, className: "rounded-xl ring-4 ring-azul/70" };
        const nivel = porBloco.get(n.id);
        if (nivel === "grave") return { ...n, className: "rounded-xl ring-2 ring-vermelho/80" };
        if (nivel === "aviso") return { ...n, className: "rounded-xl ring-2 ring-laranja/50" };
        return n;
      }),
    [nodes, testando, blocoTeste, porBloco],
  );

  // setas com a cor da saída de onde partem
  const edgesColoridas = useMemo(() => {
    const cores = new Map<string, string>();
    for (const n of nodes) for (const s of blocoDe(n.data.tipo).saidas(n.data.config)) cores.set(`${n.id}:${s.id}`, s.cor ?? "#5ed98c");
    return edges.map((e) => {
      const base = { ...e, style: { strokeWidth: 2, stroke: cores.get(`${e.source}:${e.sourceHandle}`) ?? "#5ed98c" } };
      if (!desempenhoVisivel) return base;
      const n = desempenhoVisivel.saidas[`${e.source}|${e.sourceHandle ?? "seguir"}`] ?? 0;
      return {
        ...base,
        label: `${n} ${n === 1 ? "pessoa" : "pessoas"}`,
        labelStyle: { fill: "#edeff2", fontSize: 11, fontWeight: 600 },
        labelBgStyle: { fill: "#161a21" },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
      };
    });
  }, [nodes, edges, desempenhoVisivel]);

  const irParaBloco = useCallback(
    (id: string) => {
      setTestando(false);
      setSelecionado(id);
      setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
      void fitView({ nodes: [{ id }], maxZoom: 1.1, duration: 400, padding: 0.6 });
    },
    [fitView, setNodes],
  );

  const alternarAtivo = () => {
    if (!ativo && graves.length > 0) {
      setPedindoAtivar(true);
      setVerProblemas(true);
      return;
    }
    setAtivo((a) => !a);
  };

  // ---------- painel ----------
  const noSelecionado = nodes.find((n) => n.id === selecionado) ?? null;

  const atualizarConfig = useCallback(
    (id: string, config: Config) => {
      setNodes((ns) => {
        const novos = ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, config } } : n));
        setEdges((es) => limparLigacoes(novos, es));
        return novos;
      });
    },
    [setNodes, setEdges],
  );

  const apagar = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      setSelecionado(null);
    },
    [setNodes, setEdges],
  );

  const duplicar = useCallback(
    (id: string) => {
      const n = nodes.find((x) => x.id === id);
      if (!n) return;
      const copia = criarNo(n.data.tipo, { x: n.position.x + 40, y: n.position.y + 40 });
      copia.data = { tipo: n.data.tipo, config: structuredClone(n.data.config) };
      setNodes((ns) => [...ns.map((x) => ({ ...x, selected: false })), { ...copia, selected: true }]);
      setSelecionado(copia.id);
    },
    [nodes, setNodes],
  );

  const textoStatus = { salvo: "Salvo", pendente: "Alterações…", salvando: "Salvando…", erro: "Erro ao salvar" }[status];
  const corStatus = status === "erro" ? "text-vermelho" : status === "salvo" ? "text-suave" : "text-laranja";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-borda bg-lateral px-4 py-3">
        <Link href="/funil" className="flex h-9 w-9 items-center justify-center rounded-lg text-suave hover:bg-elevado hover:text-texto" aria-label="Voltar para funis">
          ←
        </Link>
        <label htmlFor="nome-funil" className="sr-only">
          Nome do funil
        </label>
        <input
          id="nome-funil"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="min-h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 font-titulo text-lg font-bold text-texto hover:border-borda focus:border-limao focus:outline-none"
        />
        <span className={`text-xs ${corStatus}`} role="status">
          {textoStatus}
        </span>
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setVerProblemas((v) => !v);
              setPedindoAtivar(false);
            }}
            aria-expanded={verProblemas}
            className={`flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${
              graves.length
                ? "border-vermelho/60 bg-[#2a1215] text-vermelho"
                : problemas.length
                  ? "border-[#5a4220] bg-[#241b0e] text-laranja"
                  : "border-limao/40 bg-limao-escuro text-limao"
            }`}
          >
            {graves.length ? `⛔ ${graves.length} problema${graves.length > 1 ? "s" : ""}` : problemas.length ? `⚠ ${problemas.length} aviso${problemas.length > 1 ? "s" : ""}` : "✓ Funil ok"}
          </button>
          {verProblemas && (
            <div className="absolute top-full right-0 z-50 mt-2 flex max-h-[60vh] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-borda bg-cartao shadow-2xl">
              <div className="flex items-center justify-between border-b border-borda px-4 py-3">
                <span className="text-sm font-semibold">Checagem do funil</span>
                <button type="button" onClick={() => setVerProblemas(false)} className="text-xs text-suave hover:text-texto" aria-label="Fechar">
                  ✕
                </button>
              </div>
              {pedindoAtivar && (
                <div className="flex flex-col gap-2 border-b border-borda bg-[#2a1215] px-4 py-3 text-sm">
                  <span>
                    Esse funil tem {graves.length} problema{graves.length > 1 ? "s" : ""} que <b>travam a conversa</b>. Corrija antes de ativar.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAtivo(true);
                      setPedindoAtivar(false);
                      setVerProblemas(false);
                    }}
                    className="self-start text-xs text-suave underline hover:text-texto"
                  >
                    Ativar mesmo assim
                  </button>
                </div>
              )}
              <ul className="flex-1 overflow-y-auto">
                {problemas.length === 0 && <li className="px-4 py-6 text-center text-sm text-suave">Tudo certo! Nenhum problema encontrado.</li>}
                {[...graves, ...problemas.filter((x) => x.nivel === "aviso")].map((x, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => {
                        irParaBloco(x.blocoId);
                        setVerProblemas(false);
                      }}
                      className="flex w-full gap-3 border-b border-borda/60 px-4 py-3 text-left text-sm hover:bg-elevado"
                    >
                      <span aria-hidden>{x.nivel === "grave" ? "⛔" : "⚠️"}</span>
                      <span className={x.nivel === "grave" ? "text-texto" : "text-suave"}>{x.texto}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {funilId && (
          <button
            type="button"
            aria-pressed={verDesempenho}
            onClick={() => setVerDesempenho((v) => !v)}
            className={`flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${
              verDesempenho ? "border-laranja/60 bg-[#241b0e] text-laranja" : "border-borda bg-cartao text-texto hover:bg-elevado"
            }`}
          >
            📊 Onde desistem
          </button>
        )}
        {simular && (
          <button
            type="button"
            aria-pressed={testando}
            onClick={() => {
              setTestando((t) => !t);
              setSelecionado(null);
            }}
            className={`flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${
              testando ? "border-azul/60 bg-[#0f1d2e] text-azul" : "border-borda bg-cartao text-texto hover:bg-elevado"
            }`}
          >
            ▶ Testar funil
          </button>
        )}
        <button
          type="button"
          aria-pressed={ativo}
          onClick={alternarAtivo}
          className={`flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${
            ativo ? "border-limao/50 bg-limao-escuro text-limao" : "border-borda bg-cartao text-suave"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${ativo ? "bg-limao" : "bg-suave"}`} />
          {ativo ? "Funil ativo" : "Funil pausado"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <Paleta onAdicionar={(t) => adicionar(t)} />

        <div ref={quadro} className="relative min-h-[420px] flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          {verDesempenho && (
            <div className="absolute top-3 left-3 z-10 flex max-w-[min(30rem,calc(100%-1.5rem))] flex-col gap-2 rounded-2xl border border-borda bg-cartao/95 p-3 text-sm shadow-2xl backdrop-blur">
              <div className="flex flex-wrap items-center gap-2">
                <b>Onde as pessoas desistem</b>
                <label htmlFor="periodo-desempenho" className="sr-only">
                  Período
                </label>
                <select
                  id="periodo-desempenho"
                  value={dias ?? 0}
                  onChange={(e) => setDias(Number(e.target.value) || null)}
                  className="min-h-8 rounded-lg border border-borda bg-fundo px-2 text-xs"
                >
                  <option value={1}>Hoje (24h)</option>
                  <option value={7}>Últimos 7 dias</option>
                  <option value={30}>Últimos 30 dias</option>
                  <option value={0}>Tudo</option>
                </select>
                <button type="button" onClick={() => setRecarregarDes((x) => x + 1)} className="min-h-8 rounded-lg px-2 text-xs text-suave hover:bg-elevado hover:text-texto">
                  ↻ Atualizar
                </button>
              </div>
              {carregandoDes && <span className="text-xs text-suave">Carregando…</span>}
              {erroDes && <span className="text-xs text-vermelho">{erroDes}</span>}
              {desempenho && !carregandoDes && (
                <>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>
                      <b className="text-texto">{desempenho.entraram}</b> <span className="text-suave">entraram</span>
                    </span>
                    <span>
                      <b className="text-limao">{desempenho.compraram}</b> <span className="text-suave">compraram ({pct(desempenho.compraram, desempenho.entraram)})</span>
                    </span>
                  </div>
                  {desempenho.entraram === 0 ? (
                    <span className="text-xs text-suave">Ainda não há conversas reais nesse período. (Os testes do simulador não contam.)</span>
                  ) : maioresPerdas.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-suave">Onde mais perde gente:</span>
                      {maioresPerdas.map((x) => (
                        <button key={x.id} type="button" onClick={() => irParaBloco(x.id)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-elevado">
                          <span className="font-bold text-laranja">{x.perdidos}</span>
                          <span className="truncate">
                            {x.nome} <span className="text-suave">· {x.resumo}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {Object.entries(desempenho.ab).map(([bloco, res]) => {
                    const no = nodes.find((n) => n.id === bloco);
                    if (!no || res.length < 2) return null;
                    const nomes = blocoDe("randomizador").saidas(no.data.config);
                    const porPessoa = (r: (typeof res)[number]) => (r.pessoas ? r.receitaCentavos / r.pessoas : 0);
                    const suficiente = res.every((r) => r.pessoas >= 30);
                    const melhor = [...res].sort((a, b) => porPessoa(b) - porPessoa(a))[0];
                    return (
                      <div key={bloco} className="flex flex-col gap-1.5 rounded-xl border border-borda bg-fundo p-2">
                        <button type="button" onClick={() => irParaBloco(bloco)} className="text-left text-[11px] font-semibold text-suave hover:text-texto">
                          🧪 Teste A/B · {blocoDe("randomizador").resumo(no.data.config)}
                        </button>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="text-suave">
                              <th className="text-left font-medium">Caminho</th>
                              <th className="text-right font-medium">Pessoas</th>
                              <th className="text-right font-medium">Compraram</th>
                              <th className="text-right font-medium">Faturou</th>
                              <th className="text-right font-medium">Por pessoa</th>
                            </tr>
                          </thead>
                          <tbody>
                            {res.map((r) => (
                              <tr key={r.saida} className={suficiente && r === melhor ? "text-limao" : ""}>
                                <td className="max-w-[9rem] truncate py-0.5">
                                  {suficiente && r === melhor ? "🏆 " : ""}
                                  {nomes.find((x) => x.id === r.saida)?.rotulo ?? r.saida}
                                </td>
                                <td className="text-right">{r.pessoas}</td>
                                <td className="text-right">
                                  {r.compraram} <span className="text-suave">({pct(r.compraram, r.pessoas)})</span>
                                </td>
                                <td className="text-right">{(r.receitaCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                                <td className="text-right font-semibold">{(porPessoa(r) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <span className="text-[10px] text-suave">
                          {suficiente ? "O vencedor é o que mais fatura por pessoa que entrou no caminho." : "Ainda pouco dado: espere pelo menos 30 pessoas em cada caminho antes de escolher o vencedor."}
                        </span>
                      </div>
                    );
                  })}
                  {desempenho.cortado && <span className="text-[11px] text-laranja">Histórico muito grande: mostrando parte dele. Escolha um período menor.</span>}
                  <span className="text-[11px] text-suave">Cada bloco mostra quantas pessoas passaram e quantas estão paradas nele agora. As setas mostram quantas seguiram por cada caminho.</span>
                </>
              )}
            </div>
          )}
          <DesempenhoContext.Provider value={desempenhoVisivel}>
          <ReactFlow<NoBloco, Edge>
            nodes={nodesExibidos}
            edges={edgesColoridas}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => !testando && setSelecionado(n.id)}
            onPaneClick={() => setSelecionado(null)}
            onNodesDelete={(ns) => ns.some((n) => n.id === selecionado) && setSelecionado(null)}
            colorMode="dark"
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
            minZoom={0.2}
            deleteKeyCode={["Delete", "Backspace"]}
            defaultEdgeOptions={{ type: "smoothstep", style: { strokeWidth: 2, stroke: "#5ed98c" } }}
            proOptions={{ hideAttribution: true }}
            className="!bg-fundo"
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#262b35" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => blocoDe((n as NoBloco).data.tipo).cor} maskColor="rgba(12,14,18,0.7)" className="!hidden md:!block" />
          </ReactFlow>
          </DesempenhoContext.Provider>
        </div>

        {testando && simular && (
          <div className="h-[70vh] md:h-auto">
            <Simulador
              chamar={simular}
              nodes={nodes}
              podeTestar={status === "salvo"}
              onBlocoAtual={setBlocoTeste}
              onFechar={() => {
                setTestando(false);
                setBlocoTeste(null);
              }}
            />
          </div>
        )}

        {!testando && noSelecionado && (
          <div className="max-h-[70vh] md:max-h-none">
            <PainelConfig
              key={noSelecionado.id}
              no={noSelecionado}
              produtos={produtos}
              funis={funis}
              problemas={problemas.filter((x) => x.blocoId === noSelecionado.id)}
              onChange={(c) => atualizarConfig(noSelecionado.id, c)}
              onApagar={() => apagar(noSelecionado.id)}
              onDuplicar={() => duplicar(noSelecionado.id)}
              onFechar={() => setSelecionado(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function EditorFunil({ crm, ...props }: Props) {
  return (
    <OpcoesCrmContext.Provider value={crm ?? { colunas: [], etiquetas: [], campos: [] }}>
      <ReactFlowProvider>
        <EditorInterno {...props} />
      </ReactFlowProvider>
    </OpcoesCrmContext.Provider>
  );
}
