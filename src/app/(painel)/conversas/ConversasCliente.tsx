"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui";

type Contato = {
  id: string;
  nome: string | null;
  telefone: string;
  robo_ativo: boolean;
  ultima_msg_em: string | null;
  etiquetas: string[];
  kanban_coluna_id: string | null;
};

type Mensagem = {
  id: string;
  contato_id: string;
  autor: "cliente" | "robo" | "humano";
  tipo: string;
  conteudo: string | null;
  midia_url: string | null;
  criado_em: string;
};

type Coluna = { id: string; nome: string; cor: string };

function formatarTel(t: string) {
  const d = t.replace(/\D/g, "");
  if (d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return d;
}

function hora(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date();
  return d.toDateString() === hoje.toDateString()
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function previa(m?: Mensagem) {
  if (!m) return "Sem mensagens";
  const quem = m.autor === "cliente" ? "" : m.autor === "robo" ? "🤖 " : "Você: ";
  const txt = m.conteudo || (m.tipo !== "texto" ? `[${m.tipo}]` : "");
  return quem + txt;
}

function Bolha({ m }: { m: Mensagem }) {
  const minha = m.autor !== "cliente";
  const cor = m.autor === "cliente" ? "bg-elevado" : m.autor === "robo" ? "bg-limao-escuro" : "bg-[#10283a]";
  return (
    <div className={`flex ${minha ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[78%] flex-col gap-1 rounded-2xl px-3.5 py-2 text-sm ${cor} ${minha ? "rounded-br-md" : "rounded-bl-md"}`}>
        {minha && <span className={`text-[11px] font-semibold ${m.autor === "robo" ? "text-limao" : "text-azul"}`}>{m.autor === "robo" ? "Robô" : "Você"}</span>}
        {m.midia_url && m.tipo === "imagem" ? (
          // eslint-disable-next-line @next/next/no-img-element -- mídia enviada pelo funil
          <img src={m.midia_url} alt={m.conteudo ?? "imagem"} className="max-h-60 rounded-lg" />
        ) : m.midia_url ? (
          <a href={m.midia_url} target="_blank" rel="noreferrer" className="text-azul underline">
            [{m.tipo}] abrir
          </a>
        ) : null}
        {m.conteudo && <span className="whitespace-pre-wrap break-words leading-relaxed">{m.conteudo}</span>}
        <span className="self-end text-[10px] text-suave">{hora(m.criado_em)}</span>
      </div>
    </div>
  );
}

export function ConversasCliente() {
  const [contatos, setContatos] = useState<Contato[] | null>(null);
  const [ultimas, setUltimas] = useState<Record<string, Mensagem>>({});
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [busca, setBusca] = useState("");
  const [texto, setTexto] = useState("");
  const [pausar, setPausar] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<string | null>(null);

  const carregarLista = useCallback(async () => {
    const supabase = createClient();
    const [c, m, k] = await Promise.all([
      supabase
        .from("contatos")
        .select("id, nome, telefone, robo_ativo, ultima_msg_em, etiquetas, kanban_coluna_id")
        .eq("simulacao", false)
        .order("ultima_msg_em", { ascending: false, nullsFirst: false })
        .limit(300),
      supabase.from("mensagens").select("id, contato_id, autor, tipo, conteudo, midia_url, criado_em").order("criado_em", { ascending: false }).limit(800),
      supabase.from("kanban_colunas").select("id, nome, cor"),
    ]);
    if (c.error) {
      setErro("Não consegui carregar as conversas.");
      return;
    }
    const ult: Record<string, Mensagem> = {};
    for (const msg of (m.data ?? []) as Mensagem[]) if (!ult[msg.contato_id]) ult[msg.contato_id] = msg;
    setUltimas(ult);
    setContatos(c.data as Contato[]);
    setColunas((k.data ?? []) as Coluna[]);
  }, []);

  const carregarThread = useCallback(async (id: string) => {
    const { data } = await createClient()
      .from("mensagens")
      .select("id, contato_id, autor, tipo, conteudo, midia_url, criado_em")
      .eq("contato_id", id)
      .order("criado_em", { ascending: true })
      .limit(500);
    if (selRef.current === id) setMensagens((data ?? []) as Mensagem[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega os dados ao abrir a página
    void carregarLista();
    const supabase = createClient();
    const canal = supabase
      .channel("conversas")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensagens" }, (payload) => {
        const m = payload.new as Mensagem;
        setUltimas((u) => ({ ...u, [m.contato_id]: m }));
        if (m.contato_id === selRef.current) setMensagens((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]));
        setContatos((cs) => {
          if (!cs) return cs;
          const i = cs.findIndex((c) => c.id === m.contato_id);
          if (i < 0) {
            void carregarLista();
            return cs;
          }
          const c = { ...cs[i], ultima_msg_em: m.criado_em };
          return [c, ...cs.slice(0, i), ...cs.slice(i + 1)];
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "contatos" }, (payload) => {
        const n = payload.new as Contato & { simulacao?: boolean };
        if (n.simulacao) return;
        setContatos((cs) => cs?.map((c) => (c.id === n.id ? { ...c, robo_ativo: n.robo_ativo, nome: n.nome, etiquetas: n.etiquetas, kanban_coluna_id: n.kanban_coluna_id } : c)) ?? cs);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [carregarLista]);

  useEffect(() => {
    selRef.current = selecionado;
    if (selecionado) void carregarThread(selecionado);
  }, [selecionado, carregarThread]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!contatos) return [];
    if (!q) return contatos;
    return contatos.filter((c) => (c.nome ?? "").toLowerCase().includes(q) || c.telefone.includes(q.replace(/\D/g, "") || "§"));
  }, [contatos, busca]);

  const atual = contatos?.find((c) => c.id === selecionado) ?? null;
  const colunaAtual = colunas.find((k) => k.id === atual?.kanban_coluna_id);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!atual || !texto.trim()) return;
    setErro(null);
    setEnviando(true);
    const { error } = await createClient().functions.invoke("motor/enviar", { body: { contato_id: atual.id, texto, pausar_robo: pausar } });
    setEnviando(false);
    if (error) {
      let msg = "Não consegui enviar.";
      try {
        const j = await (error as { context?: Response }).context?.json();
        if (j?.erro) msg = j.erro;
      } catch {
        /* sem corpo */
      }
      setErro(msg);
      return;
    }
    setTexto("");
    if (pausar) setContatos((cs) => cs?.map((c) => (c.id === atual.id ? { ...c, robo_ativo: false } : c)) ?? cs);
  }

  async function alternarRobo() {
    if (!atual) return;
    const novo = !atual.robo_ativo;
    setContatos((cs) => cs?.map((c) => (c.id === atual.id ? { ...c, robo_ativo: novo } : c)) ?? cs);
    const { error } = await createClient().from("contatos").update({ robo_ativo: novo }).eq("id", atual.id);
    if (error) {
      setErro("Não consegui alterar o robô dessa conversa.");
      void carregarLista();
    }
  }

  return (
    <>
      <PageHeader title="Conversas" subtitle="Acompanhe o robô vendendo ao vivo e assuma quando precisar" />

      <div className="grid h-[calc(100dvh-190px)] min-h-[480px] grid-cols-1 overflow-hidden rounded-2xl border border-borda bg-cartao md:grid-cols-[320px_1fr]">
        {/* Lista */}
        <aside className={`flex min-h-0 flex-col border-borda md:border-r ${selecionado ? "hidden md:flex" : "flex"}`}>
          <div className="border-b border-borda p-3">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar nome ou telefone"
              aria-label="Buscar conversa"
              className="w-full min-h-10 rounded-[10px] border border-borda bg-fundo px-3 text-sm placeholder:text-suave/70 focus:border-limao focus:outline-none"
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {contatos === null && !erro && <li className="p-4 text-sm text-suave">Carregando…</li>}
            {contatos?.length === 0 && (
              <li className="p-6 text-center text-sm text-suave">Nenhuma conversa ainda. Quando alguém mandar mensagem num chip conectado, aparece aqui na hora.</li>
            )}
            {filtrados.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelecionado(c.id)}
                  className={`flex w-full items-start gap-3 border-b border-borda/60 px-4 py-3 text-left hover:bg-elevado ${selecionado === c.id ? "bg-elevado" : ""}`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lateral font-titulo text-sm font-bold text-limao">
                    {(c.nome ?? c.telefone).trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{c.nome || formatarTel(c.telefone)}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-suave">{hora(ultimas[c.id]?.criado_em ?? c.ultima_msg_em)}</span>
                    </span>
                    <span className="truncate text-xs text-suave">{previa(ultimas[c.id])}</span>
                    {!c.robo_ativo && <span className="text-[11px] font-semibold text-laranja">Robô pausado</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Conversa */}
        <section className={`min-h-0 flex-col ${selecionado ? "flex" : "hidden md:flex"}`}>
          {!atual ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-suave">Escolha uma conversa à esquerda.</div>
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-borda px-4 py-3">
                <button type="button" onClick={() => setSelecionado(null)} className="min-h-9 rounded-lg px-2 text-sm text-suave md:hidden" aria-label="Voltar">
                  ←
                </button>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">{atual.nome || formatarTel(atual.telefone)}</span>
                  <span className="text-xs text-suave">
                    {formatarTel(atual.telefone)}
                    {colunaAtual ? ` · ${colunaAtual.nome}` : ""}
                  </span>
                </div>
                {atual.etiquetas?.length > 0 && (
                  <span className="hidden flex-wrap gap-1 lg:flex">
                    {atual.etiquetas.slice(0, 3).map((t) => (
                      <span key={t} className="rounded-full bg-elevado px-2 py-0.5 text-[11px] text-suave">
                        {t}
                      </span>
                    ))}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={alternarRobo}
                    aria-pressed={atual.robo_ativo}
                    className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${
                      atual.robo_ativo ? "border-limao/50 bg-limao-escuro text-limao" : "border-[#5a4220] bg-[#241b0e] text-laranja"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${atual.robo_ativo ? "bg-limao" : "bg-laranja"}`} />
                    {atual.robo_ativo ? "Robô atendendo" : "Robô pausado"}
                  </button>
                  <Link href="/crm/contatos" className="min-h-9 rounded-lg px-2 py-2 text-xs text-suave hover:text-texto">
                    CRM
                  </Link>
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto bg-fundo/40 px-4 py-4">
                <div className="flex flex-col gap-2">
                  {mensagens.map((m) => (
                    <Bolha key={m.id} m={m} />
                  ))}
                  <div ref={fimRef} />
                </div>
              </div>

              <form onSubmit={enviar} className="flex flex-col gap-2 border-t border-borda p-3">
                {erro && <p className="text-sm text-vermelho">{erro}</p>}
                <div className="flex items-end gap-2">
                  <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    rows={1}
                    placeholder="Responder como você…"
                    aria-label="Mensagem"
                    className="max-h-32 min-h-11 flex-1 resize-none rounded-[10px] border border-borda bg-fundo px-3 py-2.5 text-sm placeholder:text-suave/70 focus:border-limao focus:outline-none"
                  />
                  <button type="submit" disabled={enviando || !texto.trim()} className="min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-50">
                    {enviando ? "…" : "Enviar"}
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs text-suave">
                  <input type="checkbox" checked={pausar} onChange={(e) => setPausar(e.target.checked)} className="accent-[#5ed98c]" />
                  Pausar o robô nesta conversa quando eu responder
                </label>
              </form>
            </>
          )}
        </section>
      </div>
    </>
  );
}
