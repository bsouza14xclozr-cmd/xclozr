"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import { grafoInicial } from "@/lib/funil/grafo";
import { createClient } from "@/lib/supabase/client";
import { lerArquivo, montarArquivo, nomeDoArquivo, prepararImportacao } from "@/lib/funil/portabilidade";

async function referencias() {
  const supabase = createClient();
  const [p, f, c] = await Promise.all([
    supabase.from("produtos").select("id, nome, preco_centavos"),
    supabase.from("funis").select("id, nome"),
    supabase.from("kanban_colunas").select("id, nome"),
  ]);
  return { produtos: p.data ?? [], funis: f.data ?? [], colunas: c.data ?? [] };
}

type Funil = { id: string; nome: string; ativo: boolean; padrao: boolean; atualizado_em: string; grafo: { nodes?: unknown[] } };

export function ListaFunis() {
  const router = useRouter();
  const [funis, setFunis] = useState<Funil[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [confirmarApagar, setConfirmarApagar] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [aviso, setAviso] = useState<{ id: string; nome: string; avisos: string[]; criados: string[] } | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("funis")
      .select("id, nome, ativo, padrao, atualizado_em, grafo")
      .order("atualizado_em", { ascending: false });
    if (error) setErro("Não consegui carregar os funis.");
    else setFunis(data as Funil[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega os dados ao abrir a página
    void carregar();
  }, [carregar]);

  async function criar() {
    setCriando(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("funis")
      .insert({ nome: "Novo funil", grafo: grafoInicial(), padrao: (funis?.length ?? 0) === 0 })
      .select("id")
      .single();
    setCriando(false);
    if (error || !data) {
      setErro("Não consegui criar o funil.");
      return;
    }
    router.push(`/funil/${data.id}`);
  }

  async function exportar(f: Funil) {
    const r = await referencias();
    const arq = montarArquivo(f, r.produtos, r.funis, r.colunas);
    const url = URL.createObjectURL(new Blob([JSON.stringify(arq, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeDoArquivo(f.nome);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function duplicar(f: Funil) {
    const { data, error } = await createClient().from("funis").insert({ nome: `${f.nome} (cópia)`.slice(0, 80), grafo: f.grafo, ativo: false, padrao: false }).select("id").single();
    if (error || !data) return setErro("Não consegui duplicar o funil.");
    void carregar();
  }

  async function importar(arquivo: File) {
    setErro(null);
    setAviso(null);
    setImportando(true);
    try {
      if (arquivo.size > 2_000_000) throw new Error("Arquivo grande demais para ser um funil.");
      const arq = lerArquivo(await arquivo.text());
      const supabase = createClient();
      const r = await referencias();
      const prep = prepararImportacao(arq, r.produtos, r.funis, r.colunas);
      const novos: Record<string, string> = {};
      for (const p of prep.criar) {
        const { data } = await supabase.from("produtos").insert({ nome: p.nome, preco_centavos: p.preco_centavos }).select("id").single();
        if (data) novos[p.idAntigo] = data.id;
      }
      const { grafo, avisos } = prep.montar(novos);
      const nomes = new Set(r.funis.map((x) => x.nome));
      let nome = arq.nome;
      if (nomes.has(nome)) nome = `${arq.nome} (importado)`.slice(0, 80);
      const { data, error } = await supabase.from("funis").insert({ nome, grafo, ativo: false, padrao: (funis?.length ?? 0) === 0 }).select("id").single();
      if (error || !data) throw new Error("Não consegui salvar o funil importado.");
      setAviso({ id: data.id, nome, avisos, criados: prep.criar.map((p) => p.nome) });
      void carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setImportando(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  async function apagar(id: string) {
    const supabase = createClient();
    await supabase.from("funis").delete().eq("id", id);
    setConfirmarApagar(null);
    void carregar();
  }

  async function tornarPadrao(id: string) {
    const supabase = createClient();
    await supabase.from("funis").update({ padrao: false }).neq("id", id);
    await supabase.from("funis").update({ padrao: true }).eq("id", id);
    void carregar();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Seus funis</h2>
        <div className="flex flex-wrap gap-2">
          <input
            ref={arquivoRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importar(f);
            }}
          />
          <button
            type="button"
            onClick={() => arquivoRef.current?.click()}
            disabled={importando}
            className="min-h-11 rounded-[10px] border border-borda bg-cartao px-4 text-sm hover:bg-elevado disabled:opacity-60"
          >
            {importando ? "Importando…" : "⬆ Importar funil"}
          </button>
          <button
            type="button"
            onClick={criar}
            disabled={criando}
            className="min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60"
          >
            {criando ? "Criando…" : "+ Novo funil"}
          </button>
        </div>
      </div>

      {aviso && (
        <div className="flex flex-col gap-2 rounded-xl border border-limao/40 bg-limao/10 p-4 text-sm">
          <b>
            Funil “{aviso.nome}” importado! Ele entrou <span className="text-laranja">pausado</span> para você revisar antes de ativar.
          </b>
          {aviso.criados.length > 0 && (
            <span className="text-suave">
              Criei {aviso.criados.length === 1 ? "o produto" : "os produtos"} {aviso.criados.map((n) => `“${n}”`).join(", ")} em Produtos e Pix. Confira o preço e cadastre a
              entrega.
            </span>
          )}
          {aviso.avisos.map((a) => (
            <span key={a} className="text-laranja">
              ⚠️ {a}
            </span>
          ))}
          <div className="flex gap-3">
            <Link href={`/funil/${aviso.id}`} className="font-semibold text-limao hover:underline">
              Abrir o funil →
            </Link>
            <button type="button" onClick={() => setAviso(null)} className="text-suave hover:text-texto">
              Fechar
            </button>
          </div>
        </div>
      )}

      {erro && <p className="text-sm text-vermelho">{erro}</p>}

      {funis === null && !erro && <p className="text-sm text-suave">Carregando…</p>}

      {funis?.length === 0 && (
        <EmptyState
          title="Nenhum funil ainda"
          text="Crie seu primeiro funil ou importe um arquivo de funil: monte o caminho da conversa com mensagens, perguntas, Pix, entrega e upsell."
        />
      )}

      {funis && funis.length > 0 && (
        <ul className="flex flex-col divide-y divide-borda">
          {funis.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 py-3.5">
              <Link href={`/funil/${f.id}`} className="flex min-w-0 flex-1 flex-col gap-1 hover:text-limao">
                <span className="truncate text-sm font-semibold">{f.nome}</span>
                <span className="text-xs text-suave">
                  {Math.max((f.grafo?.nodes?.length ?? 1) - 1, 0)} blocos · editado {new Date(f.atualizado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </Link>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${f.ativo ? "bg-limao-escuro text-limao" : "bg-elevado text-suave"}`}>
                {f.ativo ? "Ativo" : "Pausado"}
              </span>
              {f.padrao ? (
                <span className="rounded-full bg-elevado px-2.5 py-1 text-[11px] font-semibold text-azul">Padrão</span>
              ) : (
                <button type="button" onClick={() => tornarPadrao(f.id)} className="min-h-9 rounded-lg px-2 text-xs text-suave hover:text-texto">
                  Tornar padrão
                </button>
              )}
              <button type="button" onClick={() => void exportar(f)} className="min-h-9 rounded-lg px-2 text-xs text-suave hover:text-texto" title="Baixar o funil como arquivo">
                ⬇ Exportar
              </button>
              <button type="button" onClick={() => void duplicar(f)} className="min-h-9 rounded-lg px-2 text-xs text-suave hover:text-texto">
                Duplicar
              </button>
              {confirmarApagar === f.id ? (
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => apagar(f.id)} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-vermelho">
                    Confirmar
                  </button>
                  <button type="button" onClick={() => setConfirmarApagar(null)} className="min-h-9 rounded-lg px-2 text-xs text-suave">
                    Cancelar
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmarApagar(f.id)} className="min-h-9 rounded-lg px-2 text-xs text-suave hover:text-vermelho">
                  Apagar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
