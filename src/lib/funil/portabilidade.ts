// Exportar / importar funis como arquivo .json (para backup, copiar entre contas ou vender modelos prontos).
// IDs de produtos, funis e colunas do CRM mudam de conta para conta, então o arquivo leva os NOMES
// e na importação eles são procurados de novo pelo nome.
import { normalizarGrafo, type Grafo } from "./grafo";

export const FORMATO = "xclozr-funil";
export const VERSAO = 1;

type ProdutoRef = { id: string; nome: string; preco_centavos: number };
type Ref = { id: string; nome: string };

export type ArquivoFunil = {
  formato: typeof FORMATO;
  versao: number;
  exportado_em: string;
  nome: string;
  grafo: Grafo;
  referencias: {
    produtos: Record<string, { nome: string; preco_centavos: number }>;
    funis: Record<string, string>;
    colunas: Record<string, string>;
  };
};

type Cfg = Record<string, unknown>;

/** Percorre todos os lugares do grafo que apontam para produto, funil ou coluna. */
function visitar(grafo: Grafo, f: { produto: (id: string) => string; funil: (id: string) => string; coluna: (id: string) => string }): Grafo {
  return {
    ...grafo,
    nodes: grafo.nodes.map((n) => {
      const config: Cfg = { ...(n.data.config as Cfg) };
      if (typeof config.produtoId === "string" && config.produtoId) config.produtoId = f.produto(config.produtoId);
      if (typeof config.funilId === "string" && config.funilId) config.funilId = f.funil(config.funilId);
      if (Array.isArray(config.acoes)) {
        config.acoes = (config.acoes as Cfg[]).map((a) => (a?.tipo === "kanban_mover" && typeof a.valor === "string" && a.valor ? { ...a, valor: f.coluna(a.valor) } : a));
      }
      return { ...n, data: { ...n.data, config } };
    }),
  };
}

export function montarArquivo(funil: { nome: string; grafo: unknown }, produtos: ProdutoRef[], funis: Ref[], colunas: Ref[]): ArquivoFunil {
  const grafo = normalizarGrafo(funil.grafo);
  const ref: ArquivoFunil["referencias"] = { produtos: {}, funis: {}, colunas: {} };
  const P = new Map(produtos.map((p) => [p.id, p]));
  const F = new Map(funis.map((x) => [x.id, x.nome]));
  const C = new Map(colunas.map((x) => [x.id, x.nome]));
  visitar(grafo, {
    produto: (id) => {
      const p = P.get(id);
      if (p) ref.produtos[id] = { nome: p.nome, preco_centavos: p.preco_centavos };
      return id;
    },
    funil: (id) => {
      if (F.has(id)) ref.funis[id] = F.get(id)!;
      return id;
    },
    coluna: (id) => {
      if (C.has(id)) ref.colunas[id] = C.get(id)!;
      return id;
    },
  });
  return { formato: FORMATO, versao: VERSAO, exportado_em: new Date().toISOString(), nome: funil.nome, grafo, referencias: ref };
}

export function nomeDoArquivo(nome: string) {
  const base = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `${base.startsWith("funil") ? "" : "funil-"}${base || "xclozr"}.json`;
}

export function lerArquivo(texto: string): ArquivoFunil {
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    throw new Error("Esse arquivo não é um funil do XClozr (não consegui ler o JSON).");
  }
  const a = j as Partial<ArquivoFunil>;
  if (a?.formato !== FORMATO || !a.grafo || !Array.isArray((a.grafo as Grafo).nodes)) throw new Error("Esse arquivo não é um funil exportado pelo XClozr.");
  if ((a.versao ?? 0) > VERSAO) throw new Error("Esse funil foi exportado por uma versão mais nova do XClozr.");
  if (!(a.grafo as Grafo).nodes.some((n) => n?.data?.tipo === "inicio")) throw new Error("O funil do arquivo não tem o bloco Início.");
  return {
    formato: FORMATO,
    versao: a.versao ?? VERSAO,
    exportado_em: a.exportado_em ?? "",
    nome: String(a.nome ?? "Funil importado").slice(0, 80),
    grafo: normalizarGrafo(a.grafo),
    referencias: { produtos: a.referencias?.produtos ?? {}, funis: a.referencias?.funis ?? {}, colunas: a.referencias?.colunas ?? {} },
  };
}

const chave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/**
 * Troca os IDs do arquivo pelos da conta atual (procurando pelo nome).
 * Produtos que não existem são devolvidos em `criar` para serem cadastrados antes.
 */
export function prepararImportacao(arq: ArquivoFunil, produtos: ProdutoRef[], funis: Ref[], colunas: Ref[]) {
  const pNome = new Map(produtos.map((p) => [chave(p.nome), p.id]));
  const fNome = new Map(funis.map((x) => [chave(x.nome), x.id]));
  const cNome = new Map(colunas.map((x) => [chave(x.nome), x.id]));
  const criar = new Map<string, { nome: string; preco_centavos: number }>();
  const avisos = new Set<string>();

  const usados = { produtos: new Set<string>() };
  visitar(arq.grafo, {
    produto: (id) => (usados.produtos.add(id), id),
    funil: (id) => id,
    coluna: (id) => id,
  });
  for (const id of usados.produtos) {
    const r = arq.referencias.produtos[id];
    if (r && !pNome.has(chave(r.nome)) && r.preco_centavos > 0) criar.set(id, r);
  }

  return {
    criar: [...criar.entries()].map(([idAntigo, p]) => ({ idAntigo, ...p })),
    /** chame depois de criar os produtos que faltavam, passando idAntigo → idNovo */
    montar: (novos: Record<string, string>) => {
      const grafo = visitar(arq.grafo, {
        produto: (id) => {
          if (novos[id]) return novos[id];
          const r = arq.referencias.produtos[id];
          const achado = r ? pNome.get(chave(r.nome)) : produtos.some((p) => p.id === id) ? id : undefined;
          if (!achado) avisos.add("Um bloco ficou sem produto: escolha o produto nele antes de ativar.");
          return achado ?? "";
        },
        funil: (id) => {
          const nome = arq.referencias.funis[id];
          const achado = nome ? fNome.get(chave(nome)) : funis.some((f) => f.id === id) ? id : undefined;
          if (!achado) avisos.add(`O bloco “Ir para outro funil” apontava para ${nome ? `“${nome}”` : "um funil"} que não existe aqui: escolha o funil de novo.`);
          return achado ?? "";
        },
        coluna: (id) => {
          const nome = arq.referencias.colunas[id];
          const achado = nome ? cNome.get(chave(nome)) : colunas.some((c) => c.id === id) ? id : undefined;
          if (!achado) avisos.add(`A ação “Mover no Kanban” apontava para a coluna ${nome ? `“${nome}”` : "de outra conta"}: escolha a coluna de novo.`);
          return achado ?? "";
        },
      });
      return { grafo, avisos: [...avisos] };
    },
  };
}
