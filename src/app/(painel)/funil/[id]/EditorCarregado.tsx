"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EditorFunil, type DadosFunil } from "@/components/funil/Editor";
import type { Opcao, OpcoesCrm } from "@/components/funil/PainelConfig";
import { normalizarGrafo } from "@/lib/funil/grafo";
import { createClient } from "@/lib/supabase/client";

type Estado =
  | { fase: "carregando" }
  | { fase: "erro"; msg: string }
  | { fase: "pronto"; dados: DadosFunil; produtos: Opcao[]; funis: Opcao[]; crm: OpcoesCrm };

export function EditorCarregado() {
  const { id } = useParams<{ id: string }>();
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const [funil, produtos, outros, colunas, etiquetas, campos] = await Promise.all([
        supabase.from("funis").select("nome, ativo, grafo").eq("id", id).single(),
        supabase.from("produtos").select("id, nome").eq("ativo", true).order("nome"),
        supabase.from("funis").select("id, nome").neq("id", id).order("nome"),
        supabase.from("kanban_colunas").select("id, nome").order("ordem"),
        supabase.from("etiquetas").select("nome").order("nome"),
        supabase.from("campos_personalizados").select("chave, rotulo").order("criado_em"),
      ]);
      if (cancelado) return;
      if (funil.error || !funil.data) {
        setEstado({ fase: "erro", msg: "Funil não encontrado." });
        return;
      }
      setEstado({
        fase: "pronto",
        dados: { nome: funil.data.nome, ativo: funil.data.ativo, grafo: normalizarGrafo(funil.data.grafo) },
        produtos: (produtos.data ?? []) as Opcao[],
        funis: (outros.data ?? []) as Opcao[],
        crm: {
          colunas: (colunas.data ?? []) as Opcao[],
          etiquetas: (etiquetas.data ?? []).map((e) => e.nome as string),
          campos: (campos.data ?? []) as { chave: string; rotulo: string }[],
        },
      });
    })();
    return () => {
      cancelado = true;
    };
  }, [id]);

  const salvar = useCallback(
    async (dados: DadosFunil) => {
      const supabase = createClient();
      const { error } = await supabase.from("funis").update({ nome: dados.nome || "Sem nome", ativo: dados.ativo, grafo: dados.grafo }).eq("id", id);
      if (error) throw error;
    },
    [id],
  );

  const simular = useCallback(
    async (corpo: { acao: string; texto?: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke("motor/simular", { body: { funil_id: id, ...corpo } });
      if (error) throw error;
      return data;
    },
    [id],
  );

  return (
    <div className="-mx-5 -my-8 h-[calc(100dvh-150px)] min-h-[560px] md:-mx-10 md:h-dvh">
      {estado.fase === "carregando" && <p className="p-8 text-sm text-suave">Carregando funil…</p>}
      {estado.fase === "erro" && (
        <div className="flex flex-col gap-3 p-8">
          <p className="text-sm text-vermelho">{estado.msg}</p>
          <Link href="/funil" className="text-sm">
            ← Voltar para funis
          </Link>
        </div>
      )}
      {estado.fase === "pronto" && <EditorFunil inicial={estado.dados} produtos={estado.produtos} funis={estado.funis} crm={estado.crm} onSalvar={salvar} simular={simular} />}
    </div>
  );
}
