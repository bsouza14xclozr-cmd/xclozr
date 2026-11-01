"use client";

// Colunas personalizáveis do relatório de anúncios (estilo Utmify)
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/dinheiro";
import type { Linha } from "./api";

/** Números somáveis de uma linha (ou do total). */
export type Soma = {
  gasto: number;
  impressoes: number;
  cliques: number;
  conversas: number;
  contatos: number;
  pix: number;
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

export function somaDe(l: Linha): Soma {
  return {
    gasto: l.gasto,
    impressoes: l.impressoes,
    cliques: l.cliques,
    conversas: l.conversas_meta,
    contatos: l.contatos,
    pix: l.pix_gerados,
    vendas: l.vendas,
    faturamento: l.faturamento,
    lucro: l.lucro,
    taxas: l.taxas,
    custo_produtos: l.custo_produtos,
    imposto_venda: l.imposto_venda,
    imposto_meta: l.imposto_meta,
    upsells: l.upsells,
    faturamento_upsell: l.faturamento_upsell,
  };
}

export function somar(ls: Linha[]): Soma {
  const t: Soma = { gasto: 0, impressoes: 0, cliques: 0, conversas: 0, contatos: 0, pix: 0, vendas: 0, faturamento: 0, lucro: 0, taxas: 0, custo_produtos: 0, imposto_venda: 0, imposto_meta: 0, upsells: 0, faturamento_upsell: 0 };
  for (const l of ls) {
    const s = somaDe(l);
    for (const k of Object.keys(t) as (keyof Soma)[]) t[k] += s[k];
  }
  return t;
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);
const fNum = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-BR"));
const fBrl = (v: number | null) => (v === null ? "—" : brl(Math.round(v)));
const fPct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
const fX = (v: number | null) => (v === null ? "—" : `${v.toFixed(2).replace(".", ",")}x`);
const sinal = (v: number | null) => (v === null || v === 0 ? "" : v > 0 ? "text-limao" : "text-vermelho");
const custoAnuncio = (s: Soma) => s.gasto + s.imposto_meta;

export type Grupo = "Meta Ads" | "WhatsApp e funil" | "Dinheiro";
export type Coluna = {
  id: string;
  nome: string;
  desc: string;
  grupo: Grupo;
  /** valor numérico (para ordenar) */
  valor: (s: Soma) => number | null;
  texto: (v: number | null) => string;
  cor?: (v: number | null, s: Soma) => string;
};

/** "orcamento" é especial (editável na linha); as demais são calculadas. */
export const COLUNAS: Coluna[] = [
  { id: "orcamento", nome: "Orçamento", desc: "Orçamento diário (clique para mudar)", grupo: "Meta Ads", valor: () => null, texto: () => "" },
  { id: "gasto", nome: "Gasto", desc: "Quanto o Meta cobrou no período", grupo: "Meta Ads", valor: (s) => s.gasto, texto: fBrl },
  { id: "impressoes", nome: "Impressões", desc: "Vezes que o anúncio apareceu", grupo: "Meta Ads", valor: (s) => s.impressoes, texto: fNum },
  { id: "cliques", nome: "Cliques", desc: "Cliques no anúncio", grupo: "Meta Ads", valor: (s) => s.cliques, texto: fNum },
  { id: "ctr", nome: "CTR", desc: "Cliques ÷ impressões", grupo: "Meta Ads", valor: (s) => div(s.cliques, s.impressoes), texto: fPct },
  { id: "cpc", nome: "CPC", desc: "Custo por clique", grupo: "Meta Ads", valor: (s) => div(s.gasto, s.cliques), texto: fBrl },
  { id: "cpm", nome: "CPM", desc: "Custo por mil impressões", grupo: "Meta Ads", valor: (s) => div(s.gasto * 1000, s.impressoes), texto: fBrl },
  { id: "conversas", nome: "Conversas", desc: "Conversas iniciadas segundo o Meta", grupo: "Meta Ads", valor: (s) => s.conversas, texto: fNum },
  { id: "custo_conversa_meta", nome: "Custo/conversa (Meta)", desc: "Gasto ÷ conversas que o Meta contou", grupo: "Meta Ads", valor: (s) => div(s.gasto, s.conversas), texto: fBrl },
  { id: "imposto_meta", nome: "Imposto Meta", desc: "Imposto sobre o gasto com anúncio (configurado em ⚙)", grupo: "Meta Ads", valor: (s) => s.imposto_meta, texto: fBrl },

  { id: "contatos", nome: "Contatos", desc: "Pessoas que chegaram no robô vindas do anúncio", grupo: "WhatsApp e funil", valor: (s) => s.contatos, texto: fNum },
  { id: "custo_contato", nome: "Custo/conversa", desc: "Gasto ÷ contatos que chegaram no robô (ou conversas do Meta)", grupo: "WhatsApp e funil", valor: (s) => div(s.gasto, s.contatos || s.conversas), texto: fBrl },
  { id: "pix", nome: "Pix gerados", desc: "Pix do produto principal gerados", grupo: "WhatsApp e funil", valor: (s) => s.pix, texto: fNum },
  { id: "custo_pix", nome: "Custo por Pix", desc: "Gasto ÷ Pix gerados", grupo: "WhatsApp e funil", valor: (s) => div(s.gasto, s.pix), texto: fBrl },
  { id: "taxa_pix", nome: "% gera Pix", desc: "Pix gerados ÷ contatos", grupo: "WhatsApp e funil", valor: (s) => div(s.pix, s.contatos), texto: fPct },
  { id: "vendas", nome: "Vendas", desc: "Pix do produto principal pagos", grupo: "WhatsApp e funil", valor: (s) => s.vendas, texto: fNum },
  { id: "taxa_pagamento", nome: "% Pix pagos", desc: "Vendas ÷ Pix gerados", grupo: "WhatsApp e funil", valor: (s) => div(s.vendas, s.pix), texto: fPct },
  { id: "conv_venda", nome: "Conv. venda", desc: "Vendas ÷ contatos", grupo: "WhatsApp e funil", valor: (s) => div(s.vendas, s.contatos), texto: fPct },
  { id: "upsells", nome: "Upsells", desc: "Upsells pagos", grupo: "WhatsApp e funil", valor: (s) => s.upsells, texto: fNum },
  { id: "taxa_upsell", nome: "% aceita upsell", desc: "Upsells ÷ vendas", grupo: "WhatsApp e funil", valor: (s) => div(s.upsells, s.vendas), texto: fPct },

  { id: "faturamento", nome: "Faturamento", desc: "Tudo que foi pago (produto + upsell)", grupo: "Dinheiro", valor: (s) => s.faturamento, texto: fBrl },
  { id: "faturamento_upsell", nome: "Fat. upsell", desc: "Faturamento só dos upsells", grupo: "Dinheiro", valor: (s) => s.faturamento_upsell, texto: fBrl },
  { id: "ticket", nome: "Ticket médio", desc: "Faturamento ÷ vendas", grupo: "Dinheiro", valor: (s) => div(s.faturamento, s.vendas), texto: fBrl },
  { id: "taxas", nome: "Taxas gateway", desc: "Taxas do Pix cobradas pelo gateway", grupo: "Dinheiro", valor: (s) => s.taxas, texto: fBrl },
  { id: "custo_produtos", nome: "Custo de produto", desc: "Custo por venda cadastrado nos produtos", grupo: "Dinheiro", valor: (s) => s.custo_produtos, texto: fBrl },
  { id: "imposto_venda", nome: "Imposto venda", desc: "Imposto sobre o faturamento (configurado em ⚙)", grupo: "Dinheiro", valor: (s) => s.imposto_venda, texto: fBrl },
  { id: "custos", nome: "Custos totais", desc: "Gasto + imposto Meta + taxas + custo de produto + imposto venda", grupo: "Dinheiro", valor: (s) => custoAnuncio(s) + s.taxas + s.custo_produtos + s.imposto_venda, texto: fBrl },
  { id: "lucro", nome: "Lucro", desc: "Faturamento − todos os custos", grupo: "Dinheiro", valor: (s) => s.lucro, texto: fBrl, cor: (v) => `font-semibold ${sinal(v) || "text-suave"}` },
  { id: "roas", nome: "ROAS", desc: "Faturamento ÷ gasto", grupo: "Dinheiro", valor: (s) => div(s.faturamento, s.gasto), texto: fX, cor: (v, s) => (v === null ? "" : sinal(s.lucro || -1)) },
  { id: "roi", nome: "ROI", desc: "Lucro ÷ custo do anúncio (gasto + imposto Meta)", grupo: "Dinheiro", valor: (s) => div(s.lucro, custoAnuncio(s)), texto: fPct, cor: (v) => sinal(v) },
  { id: "margem", nome: "Margem", desc: "Lucro ÷ faturamento", grupo: "Dinheiro", valor: (s) => div(s.lucro, s.faturamento), texto: fPct, cor: (v) => sinal(v) },
  { id: "cpa", nome: "CPA", desc: "Gasto ÷ vendas (custo por venda)", grupo: "Dinheiro", valor: (s) => div(s.gasto, s.vendas), texto: fBrl },
  { id: "lucro_venda", nome: "Lucro por venda", desc: "Lucro ÷ vendas", grupo: "Dinheiro", valor: (s) => div(s.lucro, s.vendas), texto: fBrl, cor: (v) => sinal(v) },
];
export const POR_ID = new Map(COLUNAS.map((c) => [c.id, c]));
export const PADRAO = ["orcamento", "gasto", "conversas", "contatos", "pix", "vendas", "faturamento", "lucro", "roas", "roi", "cpa", "custo_contato", "conv_venda", "ctr", "cpc", "cpm"];

const CHAVE_LOCAL = "xclozr:colunas-anuncios";

/** Colunas escolhidas: salva no banco (vale em qualquer aparelho) e no navegador (abre rápido). */
export function useColunas() {
  const [ids, setIds] = useState<string[]>(PADRAO);
  useEffect(() => {
    try {
      const local = JSON.parse(window.localStorage.getItem(CHAVE_LOCAL) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferência salva no navegador
      if (Array.isArray(local)) setIds(local.filter((x) => POR_ID.has(x)));
    } catch {
      /* sem acesso ao armazenamento */
    }
    void createClient()
      .from("trafego_config")
      .select("colunas")
      .maybeSingle()
      .then(({ data }) => {
        if (Array.isArray(data?.colunas)) setIds((data.colunas as string[]).filter((x) => POR_ID.has(x)));
      });
  }, []);
  const salvar = useCallback(async (novos: string[]) => {
    setIds(novos);
    try {
      window.localStorage.setItem(CHAVE_LOCAL, JSON.stringify(novos));
    } catch {
      /* ok */
    }
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (u.user) await supabase.from("trafego_config").upsert({ dono_id: u.user.id, colunas: novos });
  }, []);
  return { ids, salvar };
}

/* ------------------------------------------------------------------ */
/* Modal "Personalizar colunas"                                        */
/* ------------------------------------------------------------------ */

export function PersonalizarColunas({ ids, onSalvar, onFechar }: { ids: string[]; onSalvar: (ids: string[]) => void; onFechar: () => void }) {
  const [sel, setSel] = useState<string[]>(ids);
  const [busca, setBusca] = useState("");
  const [arrastando, setArrastando] = useState<number | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = COLUNAS.filter((c) => !q || c.nome.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
    return (["Meta Ads", "WhatsApp e funil", "Dinheiro"] as Grupo[]).map((g) => ({ g, cols: lista.filter((c) => c.grupo === g) })).filter((x) => x.cols.length);
  }, [busca]);

  const alternar = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const mover = (de: number, para: number) =>
    setSel((s) => {
      if (para < 0 || para >= s.length) return s;
      const n = [...s];
      const [x] = n.splice(de, 1);
      n.splice(para, 0, x);
      return n;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-colunas"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-borda bg-cartao"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-borda p-5">
          <div>
            <h2 id="titulo-colunas" className="text-lg font-semibold">
              Personalize as colunas
            </h2>
            <p className="text-sm text-suave">Marque o que quer ver e arraste para mudar a ordem. Fica salvo na sua conta.</p>
          </div>
          <button type="button" onClick={onFechar} className="min-h-9 px-2 text-xl text-suave hover:text-texto" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-2">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto border-borda p-5 md:border-r">
            <input
              className="min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm placeholder:text-suave/70 focus:border-limao focus:outline-none"
              placeholder="Buscar coluna"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar coluna"
            />
            {grupos.map(({ g, cols }) => (
              <div key={g} className="flex flex-col gap-1">
                <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-suave">{g}</span>
                {cols.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-elevado">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#5ed98c]" checked={sel.includes(c.id)} onChange={() => alternar(c.id)} />
                    <span className="flex flex-col">
                      <span className="text-sm">{c.nome}</span>
                      <span className="text-[11px] text-suave">{c.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>

          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto bg-fundo/50 p-5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-suave">Ordem na tabela ({sel.length})</span>
            <div className="rounded-lg border border-borda bg-elevado/40 px-3 py-2 text-sm text-suave">Status e Nome (sempre primeiro)</div>
            <ul className="flex flex-col gap-1.5">
              {sel.map((id, i) => (
                <li
                  key={id}
                  draggable
                  onDragStart={() => setArrastando(i)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (arrastando !== null && arrastando !== i) {
                      mover(arrastando, i);
                      setArrastando(i);
                    }
                  }}
                  onDragEnd={() => setArrastando(null)}
                  className={`flex items-center gap-2 rounded-lg border bg-cartao px-2 py-1.5 text-sm ${arrastando === i ? "border-limao" : "border-borda"}`}
                >
                  <span className="cursor-grab px-1 text-suave" aria-hidden>
                    ⋮⋮
                  </span>
                  <span className="flex-1">{POR_ID.get(id)?.nome}</span>
                  <button type="button" onClick={() => mover(i, i - 1)} disabled={i === 0} className="h-8 w-8 rounded text-suave hover:bg-elevado disabled:opacity-30" aria-label={`Subir ${POR_ID.get(id)?.nome}`}>
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => mover(i, i + 1)}
                    disabled={i === sel.length - 1}
                    className="h-8 w-8 rounded text-suave hover:bg-elevado disabled:opacity-30"
                    aria-label={`Descer ${POR_ID.get(id)?.nome}`}
                  >
                    ↓
                  </button>
                  <button type="button" onClick={() => alternar(id)} className="h-8 w-8 rounded text-suave hover:bg-elevado hover:text-vermelho" aria-label={`Tirar ${POR_ID.get(id)?.nome}`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-borda p-4">
          <button type="button" onClick={() => setSel(PADRAO)} className="min-h-11 px-3 text-sm text-suave hover:text-texto">
            Restaurar padrão
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onFechar} className="min-h-11 rounded-[10px] border border-borda bg-cartao px-4 text-sm hover:bg-elevado">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                onSalvar(sel);
                onFechar();
              }}
              className="min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110"
            >
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
