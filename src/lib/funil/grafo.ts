import type { Edge, Node } from "@xyflow/react";
import { blocoDe, type Config, type TipoBloco } from "./blocos";

export type DadosBloco = { tipo: TipoBloco; config: Config };
export type NoBloco = Node<DadosBloco, "bloco">;
export type Grafo = { nodes: NoBloco[]; edges: Edge[] };

export function novoId() {
  return Math.random().toString(36).slice(2, 10);
}

export function criarNo(tipo: TipoBloco, posicao: { x: number; y: number }): NoBloco {
  return {
    id: tipo === "inicio" ? "inicio" : `${tipo}_${novoId()}`,
    type: "bloco",
    position: posicao,
    data: { tipo, config: blocoDe(tipo).padrao() },
    deletable: tipo !== "inicio",
  };
}

export function grafoInicial(): Grafo {
  return { nodes: [criarNo("inicio", { x: 80, y: 200 })], edges: [] };
}

/** Remove ligações que saem de saídas que não existem mais (ex.: opção de menu apagada). */
export function limparLigacoes(nodes: NoBloco[], edges: Edge[]): Edge[] {
  const saidasPorNo = new Map(nodes.map((n) => [n.id, new Set(blocoDe(n.data.tipo).saidas(n.data.config).map((s) => s.id))]));
  return edges.filter((e) => {
    const saidas = saidasPorNo.get(e.source);
    return saidas && saidasPorNo.has(e.target) && (!e.sourceHandle || saidas.has(e.sourceHandle));
  });
}

/** Garante um formato válido vindo do banco. */
export function normalizarGrafo(bruto: unknown): Grafo {
  const g = (bruto ?? {}) as Partial<Grafo>;
  let nodes = Array.isArray(g.nodes) ? (g.nodes as NoBloco[]) : [];
  const edges = Array.isArray(g.edges) ? (g.edges as Edge[]) : [];
  nodes = nodes
    .filter((n) => n && n.id && n.data?.tipo)
    .map((n) => ({ ...n, type: "bloco" as const, deletable: n.data.tipo !== "inicio" }));
  if (!nodes.some((n) => n.data.tipo === "inicio")) nodes.unshift(criarNo("inicio", { x: 80, y: 200 }));
  return { nodes, edges: limparLigacoes(nodes, edges) };
}

/** Versão enxuta para salvar (sem estado de seleção/medidas do canvas). */
export function paraSalvar(nodes: NoBloco[], edges: Edge[]): Grafo {
  return {
    nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data }) as NoBloco),
    edges: edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({
      id,
      source,
      target,
      sourceHandle: sourceHandle ?? null,
      targetHandle: targetHandle ?? null,
    })),
  };
}
