"use client";

import { useEffect, useState } from "react";
import { CartaoAgente } from "@/components/Mascote";
import { createClient } from "@/lib/supabase/client";

const JANELA = 2 * 60_000; // "atendendo" = respondeu alguém nos últimos 2 minutos

/** Mascote do atendente: fica no notebook enquanto a IA está respondendo clientes. */
export function AtendenteAoVivo({ ligado }: { ligado: boolean }) {
  const [ultima, setUltima] = useState<number | null>(null);
  const [recentes, setRecentes] = useState(0);
  const [agora, setAgora] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    async function olhar() {
      const desde = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data } = await createClient()
        .from("ia_uso")
        .select("criado_em, contato_id")
        .eq("simulacao", false)
        .gte("criado_em", desde)
        .order("criado_em", { ascending: false })
        .limit(50);
      if (!vivo) return;
      const linhas = (data ?? []) as { criado_em: string; contato_id: string | null }[];
      setUltima(linhas[0] ? new Date(linhas[0].criado_em).getTime() : null);
      setRecentes(new Set(linhas.map((l) => l.contato_id)).size);
      setAgora(Date.now());
    }
    void olhar();
    const t = setInterval(() => void olhar(), 15_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  const atendendo = ligado && ultima !== null && agora !== null && agora - ultima < JANELA;
  return (
    <CartaoAgente
      nome="Clozi Atendente"
      papel="atendente"
      estado={atendendo ? "trabalhando" : "parado"}
      status={!ligado ? "desligado · ligue uma IA abaixo" : atendendo ? "atendendo agora" : "esperando clientes"}
      detalhe={ligado ? (recentes ? `Conversou com ${recentes} cliente${recentes > 1 ? "s" : ""} nos últimos 10 minutos` : "Entra em ação quando o cliente foge do roteiro do funil") : undefined}
    />
  );
}
