"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import { grafoInicial } from "@/lib/funil/grafo";
import { createClient } from "@/lib/supabase/client";

type Funil = { id: string; nome: string; ativo: boolean; padrao: boolean; atualizado_em: string; grafo: { nodes?: unknown[] } };

export function ListaFunis() {
  const router = useRouter();
  const [funis, setFunis] = useState<Funil[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [confirmarApagar, setConfirmarApagar] = useState<string | null>(null);

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
        <button
          type="button"
          onClick={criar}
          disabled={criando}
          className="min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60"
        >
          {criando ? "Criando…" : "+ Novo funil"}
        </button>
      </div>

      {erro && <p className="text-sm text-vermelho">{erro}</p>}

      {funis === null && !erro && <p className="text-sm text-suave">Carregando…</p>}

      {funis?.length === 0 && (
        <EmptyState
          title="Nenhum funil ainda"
          text="Crie seu primeiro funil: monte o caminho da conversa com mensagens, perguntas, Pix, entrega e upsell."
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
