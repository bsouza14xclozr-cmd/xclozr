"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ProdutosView, type ConfigPagamento, type NovoProduto, type Produto } from "./ProdutosView";

const CAMPOS = "id, nome, descricao, preco_centavos, preco_minimo_centavos, entrega_tipo, entrega_conteudo, mensagem_entrega, ativo";
const CONFIG_VAZIA: ConfigPagamento = { gateway: null, taxa_percentual: 0, taxa_fixa_centavos: 0 };

export function ProdutosCliente() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [config, setConfig] = useState<ConfigPagamento>(CONFIG_VAZIA);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const supabase = createClient();
    const [p, c] = await Promise.all([
      supabase.from("produtos").select(CAMPOS).order("criado_em", { ascending: true }),
      supabase.from("configuracoes").select("gateway, taxa_percentual, taxa_fixa_centavos").maybeSingle(),
    ]);
    if (p.error) setErro("Não consegui carregar os produtos.");
    else setProdutos(p.data as Produto[]);
    if (c.data) setConfig({ ...c.data, taxa_percentual: Number(c.data.taxa_percentual) } as ConfigPagamento);
    setCarregando(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega os dados ao abrir a página
    void carregar();
  }, [carregar]);

  const salvarProduto = useCallback(
    async (p: NovoProduto, id?: string) => {
      const supabase = createClient();
      const { error } = id ? await supabase.from("produtos").update(p).eq("id", id) : await supabase.from("produtos").insert(p);
      if (error) throw error;
      await carregar();
    },
    [carregar],
  );

  const apagarProduto = useCallback(
    async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("produtos").delete().eq("id", id);
      if (error) setErro("Não consegui apagar. Se o produto já tem vendas, pause em vez de apagar.");
      await carregar();
    },
    [carregar],
  );

  const alternarAtivo = useCallback(
    async (p: Produto) => {
      const supabase = createClient();
      await supabase.from("produtos").update({ ativo: !p.ativo }).eq("id", p.id);
      await carregar();
    },
    [carregar],
  );

  const salvarConfig = useCallback(async (c: ConfigPagamento) => {
    const supabase = createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("sem usuário");
    const { error } = await supabase.from("configuracoes").upsert({ dono_id: u.user.id, ...c });
    if (error) throw error;
    setConfig(c);
  }, []);

  return (
    <ProdutosView
      produtos={produtos}
      config={config}
      carregando={carregando}
      erro={erro}
      onSalvarProduto={salvarProduto}
      onApagarProduto={apagarProduto}
      onAlternarAtivo={alternarAtivo}
      onSalvarConfig={salvarConfig}
    />
  );
}
