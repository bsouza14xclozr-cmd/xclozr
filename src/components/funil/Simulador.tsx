"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { blocoDe } from "@/lib/funil/blocos";
import type { NoBloco } from "@/lib/funil/grafo";

type Msg = { autor: "cliente" | "robo" | "humano"; tipo: string; conteudo: string | null; midia_url: string | null };
type Estado = {
  bloco_atual: string | null;
  aguardando: string | null;
  pix_pendente: boolean;
  finalizado: boolean;
  robo_ativo: boolean;
  etiquetas: string[];
  campos: Record<string, string>;
  coluna: string | null;
  proxima_espera: { tipo: string; executar_em: string } | null;
};
export type RespostaSimulador = { mensagens: Msg[]; estado: Estado | null; erro?: string };
export type ChamarSimulador = (corpo: { acao: string; texto?: string }) => Promise<RespostaSimulador>;

const NOME_ESPERA: Record<string, string> = {
  timeout: "“não respondeu”",
  esperar: "fim da espera",
  pix_nao_pagou: "lembrete de Pix",
  pix_expirou: "Pix expirar",
  reprocessar: "reprocessar",
};

function quando(iso: string) {
  const s = Math.max(0, (new Date(iso).getTime() - Date.now()) / 1000);
  if (s < 60) return `${Math.ceil(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

function Bolha({ m }: { m: Msg }) {
  const cliente = m.autor === "cliente";
  const midia = m.tipo !== "texto" && m.midia_url;
  return (
    <div className={`flex ${cliente ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          cliente ? "rounded-br-sm bg-[#1f4d35] text-texto" : "rounded-bl-sm bg-elevado text-texto"
        }`}
      >
        {midia && (
          <span className="mb-1 block text-xs font-semibold text-azul">
            {m.tipo === "audio" ? "▶ Áudio" : m.tipo === "imagem" ? "🖼 Imagem" : m.tipo === "video" ? "🎬 Vídeo" : "📎 Arquivo"}
          </span>
        )}
        {m.conteudo || (midia ? <span className="break-all text-[11px] text-suave">{m.midia_url}</span> : null)}
      </div>
    </div>
  );
}

export function Simulador({
  chamar,
  nodes,
  podeTestar,
  onFechar,
  onBlocoAtual,
}: {
  chamar: ChamarSimulador;
  nodes: NoBloco[];
  podeTestar: boolean;
  onFechar: () => void;
  onBlocoAtual?: (id: string | null) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  const executar = useCallback(
    async (acao: string, txt?: string) => {
      setOcupado(true);
      setErro(null);
      if (acao === "mensagem" && txt) setMsgs((m) => [...m, { autor: "cliente", tipo: "texto", conteudo: txt, midia_url: null }]);
      try {
        const r = await chamar({ acao, texto: txt });
        if (r.erro) throw new Error(r.erro);
        if (acao === "reiniciar" || acao === "estado") setMsgs(r.mensagens);
        else setMsgs((m) => [...m, ...r.mensagens]);
        setEstado(r.estado);
        onBlocoAtual?.(r.estado?.bloco_atual ?? null);
      } catch (e) {
        setErro(e instanceof Error && e.message ? `Não consegui testar: ${e.message}` : "Não consegui falar com o motor.");
      } finally {
        setOcupado(false);
      }
    },
    [chamar, onBlocoAtual],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- começa um teste limpo ao abrir
    void executar("reiniciar");
  }, [executar]);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  const noAtual = estado?.bloco_atual ? nodes.find((n) => n.id === estado.bloco_atual) : null;
  const statusTexto = !estado
    ? "Iniciando…"
    : !estado.robo_ativo
      ? "Robô pausado (passou para humano)"
      : estado.pix_pendente
        ? "Esperando o pagamento do Pix"
        : estado.aguardando
          ? `Esperando resposta em: ${noAtual ? blocoDe(noAtual.data.tipo).nome : "bloco"}`
          : estado.finalizado
            ? "Funil terminou"
            : msgs.length === 0
              ? "Mande uma mensagem como se fosse o cliente"
              : "—";

  return (
    <aside aria-label="Testar funil" className="flex h-full w-full flex-col border-l border-borda bg-lateral md:w-[400px]">
      <div className="flex items-center gap-2 border-b border-borda px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">Testar funil</span>
          <span className="truncate text-[11px] text-suave">Conversa de teste: nada vai para o WhatsApp</span>
        </div>
        <button type="button" onClick={() => void executar("reiniciar")} disabled={ocupado} className="min-h-9 rounded-lg px-2 text-xs text-suave hover:bg-elevado hover:text-texto disabled:opacity-50">
          Reiniciar
        </button>
        <button type="button" aria-label="Fechar teste" onClick={onFechar} className="flex h-9 w-9 items-center justify-center rounded-lg text-suave hover:bg-elevado hover:text-texto">
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-1.5 border-b border-borda px-4 py-2.5 text-[11px]">
        <span className="font-semibold text-texto" role="status">
          {statusTexto}
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-suave">
          {estado?.coluna && <span>CRM: {estado.coluna}</span>}
          {estado && estado.etiquetas.length > 0 && <span>Etiquetas: {estado.etiquetas.join(", ")}</span>}
          {estado &&
            Object.entries(estado.campos).map(([k, v]) => (
              <span key={k}>
                {k}: {String(v).slice(0, 30)}
              </span>
            ))}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-fundo p-4">
        {msgs.map((m, i) => (
          <Bolha key={i} m={m} />
        ))}
        {ocupado && <span className="text-xs text-suave">digitando…</span>}
        <div ref={fim} />
      </div>

      {(estado?.pix_pendente || estado?.proxima_espera) && (
        <div className="flex flex-wrap gap-2 border-t border-borda px-4 py-2.5">
          {estado.pix_pendente && (
            <button type="button" onClick={() => void executar("pagar")} disabled={ocupado} className="min-h-9 rounded-lg bg-limao-escuro px-3 text-xs font-semibold text-limao disabled:opacity-50">
              Simular Pix pago
            </button>
          )}
          {estado.proxima_espera && (
            <button type="button" onClick={() => void executar("avancar")} disabled={ocupado} className="min-h-9 rounded-lg border border-borda px-3 text-xs text-texto hover:bg-elevado disabled:opacity-50">
              Pular espera: {NOME_ESPERA[estado.proxima_espera.tipo] ?? estado.proxima_espera.tipo} (em {quando(estado.proxima_espera.executar_em)})
            </button>
          )}
        </div>
      )}

      {erro && <p className="px-4 pb-1 text-xs text-vermelho">{erro}</p>}
      {!podeTestar && <p className="px-4 pb-1 text-xs text-laranja">Salvando suas alterações… o teste usa a versão salva.</p>}

      <form
        className="flex gap-2 border-t border-borda p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const t = texto.trim();
          if (!t || ocupado || !podeTestar) return;
          setTexto("");
          void executar("mensagem", t);
        }}
      >
        <label htmlFor="sim-texto" className="sr-only">
          Mensagem do cliente
        </label>
        <input
          id="sim-texto"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escreva como se fosse o cliente…"
          className="min-h-11 flex-1 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none"
        />
        <button type="submit" disabled={ocupado || !podeTestar || !texto.trim()} className="min-h-11 rounded-[10px] bg-limao px-4 text-sm font-bold text-fundo disabled:opacity-50">
          Enviar
        </button>
      </form>
    </aside>
  );
}
