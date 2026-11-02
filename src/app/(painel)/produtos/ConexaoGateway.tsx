"use client";

// Conexão com o PagBank: o token vai direto para o servidor do robô e nunca volta para o navegador.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Status = { conectado: boolean; ambiente?: "producao" | "sandbox"; ok?: boolean; erro?: string | null; atualizado_em?: string };

const inputCls =
  "w-full min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke("pagamentos", { body: corpo });
  if (error) {
    let msg = "Algo deu errado.";
    try {
      const j = await (error as { context?: Response }).context?.json();
      if (j?.erro) msg = j.erro;
    } catch {
      /* sem corpo */
    }
    throw new Error(msg);
  }
  return data as T;
}

export function ConexaoPagBank() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [ambiente, setAmbiente] = useState<"producao" | "sandbox">("producao");
  const [trocar, setTrocar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      setStatus(await chamar<Status>({ acao: "status" }));
    } catch {
      setStatus({ conectado: false });
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao abrir
    void carregar();
  }, [carregar]);

  async function conectar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setOcupado(true);
    try {
      await chamar({ acao: "conectar", token, ambiente });
      setToken("");
      setTrocar(false);
      setMsg({ ok: true, texto: "PagBank conectado! O robô já gera Pix de verdade." });
      await carregar();
    } catch (err) {
      setMsg({ ok: false, texto: (err as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  async function remover() {
    if (!window.confirm("Desconectar o PagBank? O robô para de gerar Pix até você conectar de novo.")) return;
    await chamar({ acao: "remover" });
    await carregar();
  }

  if (!status) return <p className="text-sm text-suave">Carregando conexão…</p>;

  const mostrarForm = !status.conectado || trocar;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-borda bg-fundo p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="text-sm">Conexão com o PagBank</b>
        {status.conectado ? (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.erro ? "bg-[#241b0e] text-laranja" : "bg-limao/15 text-limao"}`}>
            {status.erro ? "● Conectado, com erro" : `● Conectado${status.ambiente === "sandbox" ? " (teste/sandbox)" : ""}`}
          </span>
        ) : (
          <span className="rounded-full border border-[#5a4220] bg-[#241b0e] px-2.5 py-1 text-xs font-semibold text-laranja">● Não conectado</span>
        )}
      </div>

      {status.conectado && status.erro && <p className="text-sm text-laranja">Último erro ao gerar Pix: {status.erro}</p>}

      {mostrarForm ? (
        <>
          <ol className="flex flex-col gap-1.5 text-sm text-suave">
            <li>
              1. Entre em <b className="text-texto">minhaconta.pagbank.com.br</b> (no computador) → menu <b className="text-texto">Venda online</b> →{" "}
              <b className="text-texto">Integrações</b> → <b className="text-texto">Gerar token</b>. O PagBank manda o token para o seu e-mail.
            </li>
            <li>
              2. Confira se sua conta tem uma <b className="text-texto">chave Pix</b> cadastrada (no app PagBank → Pix → Minhas chaves). Sem chave o PagBank não gera o QR Code.
            </li>
            <li>3. Cole o token abaixo. Eu testo gerando um Pix de R$ 1,00 que expira sozinho em 5 minutos (ninguém precisa pagar).</li>
          </ol>
          <form onSubmit={conectar} className="flex flex-col gap-3 sm:flex-row">
            <input className={inputCls} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Cole o token do PagBank" autoComplete="off" required />
            <select className={`${inputCls} sm:w-44`} value={ambiente} onChange={(e) => setAmbiente(e.target.value as "producao" | "sandbox")} aria-label="Ambiente">
              <option value="producao">Produção (real)</option>
              <option value="sandbox">Sandbox (teste)</option>
            </select>
            <button type="submit" disabled={ocupado} className="min-h-11 shrink-0 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60">
              {ocupado ? "Testando…" : "Testar e conectar"}
            </button>
          </form>
          {trocar && (
            <button type="button" onClick={() => setTrocar(false)} className="self-start text-xs text-suave hover:text-texto">
              cancelar
            </button>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-suave">O robô gera o Pix no PagBank e entrega sozinho quando o pagamento cai.</span>
          <button type="button" onClick={() => setTrocar(true)} className="text-limao hover:underline">
            Trocar token
          </button>
          <button type="button" onClick={() => void remover()} className="text-suave hover:text-vermelho">
            Desconectar
          </button>
        </div>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-limao" : "text-vermelho"}`}>{msg.texto}</p>}
    </div>
  );
}
