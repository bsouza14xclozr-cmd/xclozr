"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COLUNAS_PADRAO, type CampoPersonalizado, type Coluna, type Contato, type Etiqueta, type PatchContato } from "./tipos";

const CAMPOS_CONTATO =
  "id, telefone, nome, etiquetas, campos, kanban_coluna_id, notas, robo_ativo, criado_em, ultima_msg_em, anuncio:anuncios(nome)";

type LinhaContato = Omit<Contato, "anuncio_nome" | "total_pago_centavos" | "pix_pendente"> & {
  anuncio?: { nome: string } | { nome: string }[] | null;
};

function montar(l: LinhaContato, pagos: Map<string, number>, pendentes: Set<string>): Contato {
  const an = Array.isArray(l.anuncio) ? l.anuncio[0] : l.anuncio;
  return {
    id: l.id,
    telefone: l.telefone,
    nome: l.nome,
    etiquetas: l.etiquetas ?? [],
    campos: (l.campos as Record<string, string>) ?? {},
    kanban_coluna_id: l.kanban_coluna_id,
    notas: l.notas,
    robo_ativo: l.robo_ativo,
    criado_em: l.criado_em,
    ultima_msg_em: l.ultima_msg_em,
    anuncio_nome: an?.nome ?? null,
    total_pago_centavos: pagos.get(l.id) ?? 0,
    pix_pendente: pendentes.has(l.id),
  };
}

/**
 * Carrega e mantém atualizado (em tempo real) tudo do CRM.
 * Quando o robô muda um contato (coluna, etiqueta, campo), a tela atualiza sozinha.
 */
export function useCrm() {
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [campos, setCampos] = useState<CampoPersonalizado[]>([]);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aoVivo, setAoVivo] = useState(false);
  const pagosRef = useRef(new Map<string, number>());
  const pendentesRef = useRef(new Set<string>());

  const carregar = useCallback(async () => {
    const supabase = createClient();
    let col = await supabase.from("kanban_colunas").select("id, nome, cor, ordem, evento").order("ordem");
    if (!col.error && col.data && col.data.length === 0) {
      await supabase.from("kanban_colunas").insert(COLUNAS_PADRAO);
      col = await supabase.from("kanban_colunas").select("id, nome, cor, ordem, evento").order("ordem");
    }
    const [et, ca, co, pg] = await Promise.all([
      supabase.from("etiquetas").select("id, nome, cor").order("nome"),
      supabase.from("campos_personalizados").select("id, chave, rotulo, tipo").order("criado_em"),
      supabase.from("contatos").select(CAMPOS_CONTATO).eq("simulacao", false).order("ultima_msg_em", { ascending: false, nullsFirst: false }).limit(1000),
      supabase.from("pagamentos").select("contato_id, valor_centavos, status").eq("simulacao", false),
    ]);
    if (col.error || co.error) {
      setErro("Não consegui carregar o CRM.");
      setCarregando(false);
      return;
    }
    const pagos = new Map<string, number>();
    const pendentes = new Set<string>();
    for (const p of pg.data ?? []) {
      if (p.status === "pago") pagos.set(p.contato_id, (pagos.get(p.contato_id) ?? 0) + p.valor_centavos);
      if (p.status === "pendente") pendentes.add(p.contato_id);
    }
    pagosRef.current = pagos;
    pendentesRef.current = pendentes;
    setColunas((col.data ?? []) as Coluna[]);
    setEtiquetas((et.data ?? []) as Etiqueta[]);
    setCampos((ca.data ?? []) as CampoPersonalizado[]);
    setContatos(((co.data ?? []) as unknown as LinhaContato[]).map((l) => montar(l, pagos, pendentes)));
    setCarregando(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega os dados ao abrir a página
    void carregar();
    const supabase = createClient();
    const canal = supabase
      .channel("crm-contatos")
      .on("postgres_changes", { event: "*", schema: "public", table: "contatos" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const id = (payload.old as { id?: string }).id;
          setContatos((cs) => cs.filter((c) => c.id !== id));
          return;
        }
        const linha = payload.new as LinhaContato & { simulacao?: boolean };
        if (linha.simulacao) return;
        setContatos((cs) => {
          const antigo = cs.find((c) => c.id === linha.id);
          const novo = montar(linha, pagosRef.current, pendentesRef.current);
          if (antigo) novo.anuncio_nome = antigo.anuncio_nome;
          return antigo ? cs.map((c) => (c.id === linha.id ? novo : c)) : [novo, ...cs];
        });
      })
      .subscribe((status) => setAoVivo(status === "SUBSCRIBED"));
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [carregar]);

  /* ---------- contatos ---------- */
  const atualizarContato = useCallback(async (id: string, patch: PatchContato) => {
    setContatos((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const { error } = await createClient().from("contatos").update(patch).eq("id", id);
    if (error) setErro("Não consegui salvar a alteração do contato.");
  }, []);

  /* ---------- colunas ---------- */
  const salvarColuna = useCallback(
    async (c: Partial<Coluna> & { nome: string }, id?: string) => {
      const supabase = createClient();
      const dados = { nome: c.nome, cor: c.cor, evento: c.evento ?? null, ordem: c.ordem ?? colunas.length };
      // se o evento já estava em outra coluna, tira de lá antes (cada evento leva a uma coluna só)
      if (dados.evento) await supabase.from("kanban_colunas").update({ evento: null }).eq("evento", dados.evento).neq("id", id ?? "");
      const { error } = id ? await supabase.from("kanban_colunas").update(dados).eq("id", id) : await supabase.from("kanban_colunas").insert(dados);
      if (error) setErro("Não consegui salvar a coluna.");
      await carregar();
    },
    [carregar, colunas.length],
  );

  const apagarColuna = useCallback(
    async (id: string) => {
      await createClient().from("kanban_colunas").delete().eq("id", id);
      await carregar();
    },
    [carregar],
  );

  const reordenarColunas = useCallback(
    async (ids: string[]) => {
      setColunas((cs) => ids.map((id, i) => ({ ...cs.find((c) => c.id === id)!, ordem: i })));
      const supabase = createClient();
      await Promise.all(ids.map((id, i) => supabase.from("kanban_colunas").update({ ordem: i }).eq("id", id)));
    },
    [],
  );

  /* ---------- etiquetas ---------- */
  const salvarEtiqueta = useCallback(
    async (e: { nome: string; cor: string }, id?: string) => {
      const supabase = createClient();
      const nome = e.nome.trim();
      if (!nome) return;
      if (id) {
        const antiga = etiquetas.find((x) => x.id === id);
        await supabase.from("etiquetas").update({ nome, cor: e.cor }).eq("id", id);
        // renomeia nos contatos que já usavam o nome antigo
        if (antiga && antiga.nome !== nome) {
          for (const c of contatos.filter((c) => c.etiquetas.includes(antiga.nome))) {
            await supabase.from("contatos").update({ etiquetas: c.etiquetas.map((x) => (x === antiga.nome ? nome : x)) }).eq("id", c.id);
          }
        }
      } else {
        const { error } = await supabase.from("etiquetas").insert({ nome, cor: e.cor });
        if (error) setErro("Já existe uma etiqueta com esse nome.");
      }
      await carregar();
    },
    [carregar, etiquetas, contatos],
  );

  const apagarEtiqueta = useCallback(
    async (id: string) => {
      await createClient().from("etiquetas").delete().eq("id", id);
      await carregar();
    },
    [carregar],
  );

  /* ---------- campos ---------- */
  const salvarCampo = useCallback(
    async (c: Omit<CampoPersonalizado, "id">) => {
      const { error } = await createClient().from("campos_personalizados").insert(c);
      if (error) setErro("Não consegui criar o campo (talvez a chave já exista).");
      await carregar();
    },
    [carregar],
  );

  const apagarCampo = useCallback(
    async (id: string) => {
      await createClient().from("campos_personalizados").delete().eq("id", id);
      await carregar();
    },
    [carregar],
  );

  return {
    colunas,
    etiquetas,
    campos,
    contatos,
    carregando,
    erro,
    aoVivo,
    atualizarContato,
    salvarColuna,
    apagarColuna,
    reordenarColunas,
    salvarEtiqueta,
    apagarEtiqueta,
    salvarCampo,
    apagarCampo,
  };
}

export type Crm = ReturnType<typeof useCrm>;
