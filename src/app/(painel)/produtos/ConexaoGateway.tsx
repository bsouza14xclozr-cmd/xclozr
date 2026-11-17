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

// Conexão com a LivePix: Client ID e Client Secret vão direto para o servidor do robô e nunca voltam para o navegador.
export function ConexaoLivePix() {
  const [status, setStatus] = useState<(Status & { gateway?: string }) | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [trocar, setTrocar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      setStatus(await chamar<Status & { gateway?: string }>({ acao: "status" }));
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
      await chamar({ acao: "conectar", gateway: "livepix", client_id: clientId, client_secret: clientSecret });
      setClientId("");
      setClientSecret("");
      setTrocar(false);
      setMsg({ ok: true, texto: "LivePix conectada! O robô já manda o link do Pix e entrega sozinho quando o pagamento cai." });
      await carregar();
    } catch (err) {
      setMsg({ ok: false, texto: (err as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  async function remover() {
    if (!window.confirm("Desconectar a LivePix? O robô para de gerar Pix até você conectar de novo.")) return;
    await chamar({ acao: "remover" });
    await carregar();
  }

  if (!status) return <p className="text-sm text-suave">Carregando conexão…</p>;

  const conectadaAqui = status.conectado && status.gateway === "livepix";
  const mostrarForm = !conectadaAqui || trocar;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-borda bg-fundo p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="text-sm">Conexão com a LivePix</b>
        {conectadaAqui ? (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.erro ? "bg-[#241b0e] text-laranja" : "bg-limao/15 text-limao"}`}>
            {status.erro ? "● Conectada, com erro" : "● Conectada"}
          </span>
        ) : (
          <span className="rounded-full border border-[#5a4220] bg-[#241b0e] px-2.5 py-1 text-xs font-semibold text-laranja">● Não conectada</span>
        )}
      </div>

      {conectadaAqui && status.erro && <p className="text-sm text-laranja">Último erro ao gerar Pix: {status.erro}</p>}
      {status.conectado && status.gateway && status.gateway !== "livepix" && (
        <p className="text-sm text-laranja">Hoje o robô usa o {status.gateway === "pagbank" ? "PagBank" : status.gateway}. Conectar a LivePix substitui essa conexão.</p>
      )}

      {mostrarForm ? (
        <>
          <ol className="flex flex-col gap-1.5 text-sm text-suave">
            <li>
              1. Entre em <b className="text-texto">dashboard.livepix.gg</b> → <b className="text-texto">Configurações</b> → <b className="text-texto">API</b> →{" "}
              <b className="text-texto">Criar aplicação</b>.
            </li>
            <li>
              2. Marque as permissões de <b className="text-texto">pagamentos</b> (ler e criar) e de <b className="text-texto">webhooks</b>, salve e copie o{" "}
              <b className="text-texto">Client ID</b> e o <b className="text-texto">Client Secret</b>.
            </li>
            <li>3. Cole os dois abaixo. Eu testo criando um link de R$ 1,00 (ninguém precisa pagar) e cadastro o aviso de pagamento automático.</li>
          </ol>
          <form onSubmit={conectar} className="flex flex-col gap-3 sm:flex-row">
            <input className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" autoComplete="off" required />
            <input className={inputCls} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Client Secret" autoComplete="off" required />
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
          <span className="text-suave">O robô manda o link do Pix da LivePix e entrega sozinho quando o pagamento cai.</span>
          <button type="button" onClick={() => setTrocar(true)} className="text-limao hover:underline">
            Trocar credenciais
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

// Conexão com o Asaas: a chave de API vai direto para o servidor do robô e nunca volta para o navegador.
export function ConexaoAsaas() {
  const [status, setStatus] = useState<(Status & { gateway?: string }) | null>(null);
  const [token, setToken] = useState("");
  const [ambiente, setAmbiente] = useState<"producao" | "sandbox">("producao");
  const [trocar, setTrocar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      setStatus(await chamar<Status & { gateway?: string }>({ acao: "status" }));
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
      const r = await chamar<{ ok: boolean; aviso?: string }>({ acao: "conectar", gateway: "asaas", token, ambiente });
      setToken("");
      setTrocar(false);
      setMsg({ ok: true, texto: r.aviso ?? "Asaas conectado! O robô já gera Pix copia e cola de verdade e entrega sozinho quando o pagamento cai." });
      await carregar();
    } catch (err) {
      setMsg({ ok: false, texto: (err as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  async function remover() {
    if (!window.confirm("Desconectar o Asaas? O robô para de gerar Pix até você conectar de novo.")) return;
    await chamar({ acao: "remover" });
    await carregar();
  }

  if (!status) return <p className="text-sm text-suave">Carregando conexão…</p>;

  const conectadoAqui = status.conectado && status.gateway === "asaas";
  const mostrarForm = !conectadoAqui || trocar;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-borda bg-fundo p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="text-sm">Conexão com o Asaas</b>
        {conectadoAqui ? (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.erro ? "bg-[#241b0e] text-laranja" : "bg-limao/15 text-limao"}`}>
            {status.erro ? "● Conectado, com erro" : `● Conectado${status.ambiente === "sandbox" ? " (teste/sandbox)" : ""}`}
          </span>
        ) : (
          <span className="rounded-full border border-[#5a4220] bg-[#241b0e] px-2.5 py-1 text-xs font-semibold text-laranja">● Não conectado</span>
        )}
      </div>

      {conectadoAqui && status.erro && <p className="text-sm text-laranja">Último erro ao gerar Pix: {status.erro}</p>}
      {status.conectado && status.gateway && status.gateway !== "asaas" && (
        <p className="text-sm text-laranja">Hoje o robô usa {status.gateway === "pagbank" ? "o PagBank" : status.gateway === "livepix" ? "a LivePix" : status.gateway}. Conectar o Asaas substitui essa conexão.</p>
      )}

      {mostrarForm ? (
        <>
          <ol className="flex flex-col gap-1.5 text-sm text-suave">
            <li>
              1. No Asaas (site), clique no seu nome → <b className="text-texto">Integrações</b> → <b className="text-texto">Chaves de API</b> →{" "}
              <b className="text-texto">Gerar chave de API</b>. Ela começa com <b className="text-texto">$aact_</b> e só aparece uma vez.
            </li>
            <li>
              2. Confira se a conta tem uma <b className="text-texto">chave Pix</b> ativa (app Asaas → Pix → Minhas chaves). O cliente não precisa informar CPF.
            </li>
            <li>3. Cole a chave abaixo. Eu testo gerando um Pix de R$ 1,00 que é apagado na hora (ninguém precisa pagar) e cadastro o aviso de pagamento automático.</li>
          </ol>
          <form onSubmit={conectar} className="flex flex-col gap-3 sm:flex-row">
            <input className={inputCls} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Cole a chave de API do Asaas ($aact_…)" autoComplete="off" required />
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
          <span className="text-suave">O robô gera o Pix copia e cola no Asaas e entrega sozinho quando o pagamento cai.</span>
          <button type="button" onClick={() => setTrocar(true)} className="text-limao hover:underline">
            Trocar chave
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
