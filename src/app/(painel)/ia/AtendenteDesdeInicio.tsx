"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type No = { id: string; data: { tipo: string; config?: Record<string, unknown> } };
type FunilLinha = { id: string; nome: string; grafo: { nodes: No[]; edges: unknown[] } };

/** Liga/desliga o Atendente IA desde a 1ª mensagem no funil padrão (opção do bloco Início). */
export function AtendenteDesdeInicio({ iaLigada }: { iaLigada: boolean }) {
  const [funil, setFunil] = useState<FunilLinha | null | undefined>(undefined);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    void createClient()
      .from("funis")
      .select("id, nome, grafo")
      .eq("ativo", true)
      .eq("padrao", true)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setFunil((data as FunilLinha | null) ?? null));
  }, []);

  if (funil === undefined) return null;
  if (funil === null)
    return <p className="rounded-2xl border border-borda bg-fundo px-5 py-4 text-sm text-suave">Defina um funil padrão para ligar o Atendente IA desde a 1ª mensagem.</p>;

  const nos = funil.grafo?.nodes ?? [];
  const inicio = nos.find((n) => n.data.tipo === "inicio");
  const temObjecoes = nos.some((n) => n.data.tipo === "objecoes");
  const ligado = Boolean(inicio?.data.config?.atendenteIA);
  const podeLigar = iaLigada && temObjecoes && Boolean(inicio);

  async function alternar() {
    if (!funil || !inicio) return;
    setSalvando(true);
    setErro("");
    const grafo = {
      ...funil.grafo,
      nodes: nos.map((n) => (n.id === inicio.id ? { ...n, data: { ...n.data, config: { ...(n.data.config ?? {}), atendenteIA: !ligado } } } : n)),
    };
    const { error } = await createClient().from("funis").update({ grafo }).eq("id", funil.id);
    setSalvando(false);
    if (error) return setErro(error.message);
    setFunil({ ...funil, grafo });
  }

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-borda bg-fundo px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-texto">🤖 Atender desde a 1ª mensagem</p>
        <p className="mt-1 text-sm text-suave">
          {ligado
            ? "Ligado: assim que o lead chama, a IA já responde, tira as dúvidas e gera o Pix quando ele disser que quer. Entrega e upsell seguem o funil."
            : "Desligado: o lead recebe primeiro o roteiro do funil (boas-vindas, menu, oferta) e a IA entra nas dúvidas."}{" "}
          Funil: <b className="text-texto">{funil.nome}</b>
        </p>
        {!iaLigada && <p className="mt-1 text-sm text-laranja">Ligue uma IA abaixo primeiro.</p>}
        {iaLigada && !temObjecoes && <p className="mt-1 text-sm text-laranja">Esse funil precisa de um bloco Objeções (é nele que a IA conversa).</p>}
        {erro && <p className="mt-1 text-sm text-vermelho">{erro}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        disabled={salvando || (!ligado && !podeLigar)}
        onClick={() => void alternar()}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${ligado ? "bg-limao" : "bg-borda"}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${ligado ? "left-6" : "left-1"}`} />
      </button>
    </div>
  );
}
