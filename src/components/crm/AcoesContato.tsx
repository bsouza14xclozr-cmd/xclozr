"use client";

// Ações perigosas/especiais de um contato: reiniciar o fluxo, apagar a conversa e excluir o lead.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type FunilOpcao = { id: string; nome: string; ativo: boolean };

async function lerErro(error: unknown) {
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx?.status === 404) return { semRota: true, msg: "" };
    const j = await ctx?.json();
    return { semRota: false, msg: String(j?.erro ?? "") };
  } catch {
    return { semRota: false, msg: "" };
  }
}

/** Reinicia o fluxo: zera o funil do contato e manda a 1ª mensagem agora (ou na próxima mensagem do cliente). */
export async function reiniciarFluxo(contatoId: string, funilId: string | null, agora: boolean): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("motor/reiniciar", { body: { contato_id: contatoId, funil_id: funilId, agora } });
  if (!error) {
    const r = data as { iniciado?: boolean; aviso?: string };
    if (r.aviso) return r.aviso;
    return r.iniciado ? "Fluxo reiniciado! O robô já mandou a primeira mensagem." : "Fluxo reiniciado! Ele começa do zero quando o cliente mandar a próxima mensagem.";
  }
  const { semRota, msg } = await lerErro(error);
  if (!semRota) throw new Error(msg || "Não consegui reiniciar o fluxo.");
  // robô ainda sem a rota nova: zera pelo próprio painel (começa na próxima mensagem do cliente)
  const { error: e2 } = await supabase
    .from("contatos")
    .update({ funil_id: funilId, bloco_atual: null, aguardando: null, finalizado: false, pix_ativo: null, robo_ativo: true })
    .eq("id", contatoId);
  if (e2) throw new Error("Não consegui reiniciar o fluxo.");
  return "Fluxo reiniciado! Ele começa do zero quando o cliente mandar a próxima mensagem.";
}

/** Apaga só as mensagens (o lead continua no CRM). */
export async function apagarConversa(contatoId: string) {
  const { error } = await createClient().from("mensagens").delete().eq("contato_id", contatoId);
  if (error) throw new Error("Não consegui apagar a conversa.");
}

/** Exclui o lead e tudo dele (mensagens, Pix, histórico). Pergunta antes. Devolve true se excluiu. */
export async function excluirLead(contatoId: string, nome: string) {
  const supabase = createClient();
  const { count } = await supabase.from("pagamentos").select("id", { count: "exact", head: true }).eq("contato_id", contatoId).eq("status", "pago");
  const aviso =
    (count ?? 0) > 0
      ? `Excluir ${nome}? Esse cliente tem ${count} compra(s) paga(s): elas vão sumir dos seus relatórios de vendas e de lucro. Isso não pode ser desfeito.`
      : `Excluir ${nome}? A conversa, os Pix e o histórico dele somem do XClozr. Isso não pode ser desfeito.`;
  if (!window.confirm(aviso)) return false;
  const { error } = await supabase.from("contatos").delete().eq("id", contatoId);
  if (error) throw new Error("Não consegui excluir o lead.");
  return true;
}

/** Exclui vários leads de uma vez. Pergunta antes. Devolve quantos excluiu (0 se cancelou). */
export async function excluirLeads(ids: string[]) {
  if (!ids.length) return 0;
  const supabase = createClient();
  let compras = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { count } = await supabase.from("pagamentos").select("id", { count: "exact", head: true }).in("contato_id", ids.slice(i, i + 100)).eq("status", "pago");
    compras += count ?? 0;
  }
  const qtd = ids.length === 1 ? "1 lead" : `${ids.length} leads`;
  const aviso =
    compras > 0
      ? `Excluir ${qtd}? Entre eles há ${compras} compra(s) paga(s): elas vão sumir dos seus relatórios de vendas e de lucro. Conversas, Pix e histórico também somem. Isso não pode ser desfeito.`
      : `Excluir ${qtd}? As conversas, os Pix e o histórico deles somem do XClozr. Isso não pode ser desfeito.`;
  if (!window.confirm(aviso)) return 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase.from("contatos").delete().in("id", ids.slice(i, i + 100));
    if (error) throw new Error("Não consegui excluir todos os leads. Atualize a página e confira.");
  }
  return ids.length;
}

/** Bloco de ações para a ficha do contato e para a tela de Conversas. */
export function AcoesContato({
  contatoId,
  nome,
  funilAtual,
  onConversaApagada,
  onExcluido,
  compacto = false,
}: {
  contatoId: string;
  nome: string;
  funilAtual?: string | null;
  onConversaApagada?: () => void;
  onExcluido?: () => void;
  compacto?: boolean;
}) {
  const [funis, setFunis] = useState<FunilOpcao[]>([]);
  const [abrirReinicio, setAbrirReinicio] = useState(false);
  const [funil, setFunil] = useState<string>(funilAtual ?? "");
  const [agora, setAgora] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    if (!abrirReinicio || funis.length) return;
    void createClient()
      .from("funis")
      .select("id, nome, ativo")
      .order("criado_em", { ascending: false })
      .then(({ data }) => setFunis((data ?? []) as FunilOpcao[]));
  }, [abrirReinicio, funis.length]);

  async function rodar(fn: () => Promise<string | void>) {
    setMsg(null);
    setOcupado(true);
    try {
      const t = await fn();
      if (t) setMsg({ ok: true, texto: t });
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  const botao = "min-h-10 rounded-[10px] border px-3 text-sm font-medium disabled:opacity-60";
  return (
    <div className="flex flex-col gap-2">
      {!compacto && <span className="text-[13px] font-medium">Ações</span>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={ocupado} onClick={() => setAbrirReinicio((v) => !v)} className={`${botao} border-limao/50 text-limao hover:bg-limao/10`}>
          ↻ Reiniciar fluxo
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={() =>
            void rodar(async () => {
              if (!window.confirm(`Apagar todas as mensagens da conversa com ${nome}? O lead continua no CRM.`)) return;
              await apagarConversa(contatoId);
              onConversaApagada?.();
              return "Conversa apagada.";
            })
          }
          className={`${botao} border-borda text-suave hover:bg-elevado hover:text-texto`}
        >
          Apagar conversa
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={() =>
            void rodar(async () => {
              if (await excluirLead(contatoId, nome)) onExcluido?.();
            })
          }
          className={`${botao} border-vermelho/50 text-vermelho hover:bg-vermelho/10`}
        >
          Excluir lead
        </button>
      </div>

      {abrirReinicio && (
        <div className="flex flex-col gap-2 rounded-xl border border-borda bg-fundo p-3 text-sm">
          <label htmlFor={`reinicio-funil-${contatoId}`} className="text-xs text-suave">
            Começar de novo no funil
          </label>
          <select id={`reinicio-funil-${contatoId}`} className="min-h-10 rounded-[10px] border border-borda bg-fundo px-3 text-sm" value={funil} onChange={(e) => setFunil(e.target.value)}>
            <option value="">Funil padrão (o do anúncio ou o funil ativo)</option>
            {funis.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
                {f.ativo ? "" : " (pausado)"}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-suave">
            <input type="checkbox" className="h-4 w-4 accent-limao" checked={agora} onChange={(e) => setAgora(e.target.checked)} />
            Mandar a primeira mensagem agora (senão começa quando o cliente escrever)
          </label>
          <p className="text-xs text-suave">O Pix pendente e os lembretes do fluxo antigo são cancelados e o robô volta a atender.</p>
          <button
            type="button"
            disabled={ocupado}
            onClick={() =>
              void rodar(async () => {
                const t = await reiniciarFluxo(contatoId, funil || null, agora);
                setAbrirReinicio(false);
                return t;
              })
            }
            className="min-h-10 self-start rounded-[10px] bg-limao px-4 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60"
          >
            {ocupado ? "Reiniciando…" : "Reiniciar agora"}
          </button>
        </div>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-limao" : "text-vermelho"}`}>{msg.texto}</p>}
    </div>
  );
}
