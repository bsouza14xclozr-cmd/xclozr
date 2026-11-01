"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, EmptyState, PageHeader } from "@/components/ui";

type Numero = {
  id: string;
  nome: string;
  telefone: string | null;
  status: "conectado" | "conectando" | "desconectado" | string;
  robo_ligado: boolean;
  conectado_em: string | null;
};

type StatusEvo = { configurada: boolean; servidor: string | null };

const inputCls =
  "w-full min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";
const btnPrim = "min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60";
const btnSec = "min-h-10 rounded-[10px] border border-borda bg-cartao px-4 text-sm text-texto hover:bg-elevado disabled:opacity-60";

async function chamar<T = Record<string, unknown>>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke("motor/numeros", { body: corpo });
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

function formatarTel(t: string | null) {
  if (!t) return "—";
  const d = t.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return `+${d}`;
}

function StatusChip({ status }: { status: string }) {
  const s =
    status === "conectado"
      ? { t: "Conectado", c: "bg-limao-escuro text-limao", p: "bg-limao" }
      : status === "conectando"
        ? { t: "Aguardando QR", c: "bg-[#241b0e] text-laranja", p: "bg-laranja" }
        : { t: "Desconectado", c: "bg-[#2a1215] text-vermelho", p: "bg-vermelho" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.c}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.p}`} />
      {s.t}
    </span>
  );
}

/* ------------------------------------------------------------------ */

function CartaoServidor({ status, onSalvo }: { status: StatusEvo | null; onSalvo: (s: StatusEvo) => void }) {
  const [editando, setEditando] = useState(false);
  const [url, setUrl] = useState("");
  const [apikey, setApikey] = useState("");
  const [estado, setEstado] = useState<"" | "salvando">("");
  const [erro, setErro] = useState<string | null>(null);

  const aberto = editando || (status !== null && !status.configurada);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEstado("salvando");
    try {
      const r = await chamar<{ servidor: string }>({ acao: "config", url, apikey });
      setApikey("");
      setEditando(false);
      onSalvo({ configurada: true, servidor: r.servidor });
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEstado("");
    }
  }

  if (status === null) return null;

  if (!aberto)
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-borda bg-cartao px-5 py-4 text-sm">
        <span className="h-2 w-2 rounded-full bg-limao" />
        <span className="text-suave">Servidor Evolution:</span>
        <span className="font-semibold">{status.servidor}</span>
        <button type="button" onClick={() => setEditando(true)} className="ml-auto min-h-9 rounded-lg px-2 text-xs text-suave hover:text-texto">
          Trocar servidor
        </button>
      </div>
    );

  return (
    <Card title="Ligar sua Evolution API">
      <p className="text-sm text-suave">
        Coloque o endereço público da sua Evolution e a <b className="text-texto">API key global</b> (a <code>AUTHENTICATION_API_KEY</code> do servidor). A chave fica
        guardada só no servidor do XClozr e nunca aparece de novo no navegador.
      </p>
      <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1.5 text-[13px] text-suave">
          Endereço da Evolution
          <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://evolution.seudominio.com" required inputMode="url" autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-suave">
          API key global
          <input
            className={inputCls}
            type="password"
            value={apikey}
            onChange={(e) => setApikey(e.target.value)}
            placeholder={status.configurada ? "deixe vazio para manter a atual" : "cole a chave aqui"}
            required={!status.configurada}
            autoComplete="off"
          />
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={estado === "salvando"} className={btnPrim}>
            {estado === "salvando" ? "Testando…" : "Testar e salvar"}
          </button>
          {status.configurada && (
            <button type="button" onClick={() => setEditando(false)} className={btnSec}>
              Cancelar
            </button>
          )}
        </div>
      </form>
      {erro && <p className="text-sm text-vermelho">{erro}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function JanelaQr({ numero, qrInicial, onFechar }: { numero: Numero; qrInicial: string | null; onFechar: () => void }) {
  const [qr, setQr] = useState<string | null>(qrInicial);
  const [conectado, setConectado] = useState(numero.status === "conectado");
  const [erro, setErro] = useState<string | null>(null);
  const tentativas = useRef(0);

  useEffect(() => {
    if (conectado) return;
    let vivo = true;
    const pedirQr = async () => {
      try {
        const r = await chamar<{ conectado: boolean; qr: string | null }>({ acao: "qr", numero_id: numero.id });
        if (!vivo) return;
        if (r.conectado) setConectado(true);
        else if (r.qr) setQr(r.qr);
      } catch (e) {
        if (vivo) setErro((e as Error).message);
      }
    };
    if (!qrInicial) void pedirQr();
    const estado = setInterval(async () => {
      try {
        const r = await chamar<{ status: string }>({ acao: "estado", numero_id: numero.id });
        if (vivo && r.status === "conectado") setConectado(true);
      } catch {
        /* tenta de novo */
      }
    }, 3000);
    // o QR do WhatsApp vence em ~40s: renova
    const renovar = setInterval(() => {
      tentativas.current += 1;
      if (tentativas.current <= 6) void pedirQr();
    }, 35_000);
    return () => {
      vivo = false;
      clearInterval(estado);
      clearInterval(renovar);
    };
  }, [conectado, numero.id, qrInicial]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Conectar ${numero.nome}`}>
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-borda bg-cartao p-6 text-center">
        <h2 className="font-titulo text-xl font-bold">{conectado ? "Conectado! 🎉" : `Conectar “${numero.nome}”`}</h2>
        {conectado ? (
          <p className="text-sm text-suave">O chip está ligado ao XClozr. A partir de agora o robô responde quem mandar mensagem nesse número (se tiver um funil ativo).</p>
        ) : (
          <>
            <div className="flex h-[264px] w-[264px] items-center justify-center rounded-xl bg-white p-3">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element -- QR em base64 vindo da Evolution
                <img src={qr} alt="QR code para conectar o WhatsApp" className="h-full w-full" />
              ) : (
                <span className="text-sm text-[#555]">{erro ? "Sem QR" : "Gerando QR…"}</span>
              )}
            </div>
            <ol className="flex flex-col gap-1 text-left text-sm text-suave">
              <li>1. Abra o WhatsApp no celular do chip</li>
              <li>2. Toque em ⋮ → Aparelhos conectados → Conectar aparelho</li>
              <li>3. Aponte a câmera para o QR acima</li>
            </ol>
            {erro && <p className="text-sm text-vermelho">{erro}</p>}
          </>
        )}
        <button type="button" onClick={onFechar} className={conectado ? btnPrim : btnSec}>
          {conectado ? "Pronto" : "Fechar"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function NumerosCliente() {
  const [status, setStatus] = useState<StatusEvo | null>(null);
  const [numeros, setNumeros] = useState<Numero[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [criando, setCriando] = useState(false);
  const [qrAberto, setQrAberto] = useState<{ numero: Numero; qr: string | null } | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await createClient()
      .from("numeros")
      .select("id, nome, telefone, status, robo_ligado, conectado_em")
      .order("criado_em");
    if (error) setErro("Não consegui carregar os números.");
    else setNumeros(data as Numero[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega os dados ao abrir a página
    void carregar();
    chamar<StatusEvo>({ acao: "status" })
      .then(setStatus)
      .catch(() => setStatus({ configurada: false, servidor: null }));
    const supabase = createClient();
    const canal = supabase
      .channel("numeros")
      .on("postgres_changes", { event: "*", schema: "public", table: "numeros" }, () => void carregar())
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [carregar]);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCriando(true);
    try {
      const nome = novoNome.trim() || `Chip ${(numeros?.length ?? 0) + 1}`;
      const r = await chamar<{ id: string; qr: string | null }>({ acao: "criar", nome });
      setNovoNome("");
      await carregar();
      setQrAberto({ numero: { id: r.id, nome, telefone: null, status: "conectando", robo_ligado: true, conectado_em: null }, qr: r.qr });
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setCriando(false);
    }
  }

  async function acao(n: Numero, a: "desconectar" | "apagar") {
    setErro(null);
    setOcupado(n.id);
    try {
      await chamar({ acao: a, numero_id: n.id });
      setConfirmar(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function alternarRobo(n: Numero) {
    setNumeros((ns) => ns?.map((x) => (x.id === n.id ? { ...x, robo_ligado: !x.robo_ligado } : x)) ?? null);
    const { error } = await createClient().from("numeros").update({ robo_ligado: !n.robo_ligado }).eq("id", n.id);
    if (error) {
      setErro("Não consegui alterar o robô desse número.");
      void carregar();
    }
  }

  const pronto = status?.configurada;

  return (
    <>
      <PageHeader title="Números de WhatsApp" subtitle="Conecte seus chips pelo QR code e escolha em quais o robô atende" />

      <CartaoServidor status={status} onSalvo={setStatus} />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Seus números</h2>
          {pronto && (
            <form onSubmit={criar} className="flex flex-wrap gap-2">
              <input
                className={`${inputCls} w-48`}
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Nome do chip (opcional)"
                maxLength={60}
                aria-label="Nome do chip"
              />
              <button type="submit" disabled={criando} className={btnPrim}>
                {criando ? "Criando…" : "+ Conectar número"}
              </button>
            </form>
          )}
        </div>

        {erro && <p className="text-sm text-vermelho">{erro}</p>}

        {numeros === null && <p className="text-sm text-suave">Carregando…</p>}

        {numeros?.length === 0 && (
          <EmptyState
            title="Nenhum número conectado"
            text={pronto ? "Clique em “Conectar número”, leia o QR code com o WhatsApp do chip e pronto." : "Primeiro ligue a sua Evolution API no quadro acima."}
          />
        )}

        {numeros && numeros.length > 0 && (
          <ul className="flex flex-col divide-y divide-borda">
            {numeros.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-3 py-3.5">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-semibold">{n.nome}</span>
                  <span className="text-xs text-suave">{formatarTel(n.telefone)}</span>
                </div>
                <StatusChip status={n.status} />
                <button
                  type="button"
                  onClick={() => alternarRobo(n)}
                  aria-pressed={n.robo_ligado}
                  className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${
                    n.robo_ligado ? "border-limao/50 bg-limao-escuro text-limao" : "border-borda bg-cartao text-suave"
                  }`}
                  title="Com o robô desligado, o chip só registra as conversas"
                >
                  <span className={`h-2 w-2 rounded-full ${n.robo_ligado ? "bg-limao" : "bg-suave"}`} />
                  {n.robo_ligado ? "Robô ligado" : "Robô desligado"}
                </button>
                {n.status !== "conectado" && pronto && (
                  <button type="button" onClick={() => setQrAberto({ numero: n, qr: null })} className={btnSec}>
                    Ler QR
                  </button>
                )}
                {confirmar === n.id ? (
                  <span className="flex items-center gap-1">
                    <button type="button" disabled={ocupado === n.id} onClick={() => acao(n, "apagar")} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-vermelho">
                      {ocupado === n.id ? "Apagando…" : "Confirmar remoção"}
                    </button>
                    <button type="button" onClick={() => setConfirmar(null)} className="min-h-9 rounded-lg px-2 text-xs text-suave">
                      Cancelar
                    </button>
                  </span>
                ) : (
                  <>
                    {n.status === "conectado" && (
                      <button type="button" disabled={ocupado === n.id} onClick={() => acao(n, "desconectar")} className="min-h-9 rounded-lg px-2 text-xs text-suave hover:text-texto">
                        Desconectar
                      </button>
                    )}
                    <button type="button" onClick={() => setConfirmar(n.id)} className="min-h-9 rounded-lg px-2 text-xs text-suave hover:text-vermelho">
                      Remover
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Antes de ligar o robô">
        <ul className="flex flex-col gap-2 text-sm text-suave">
          <li>• O robô responde <b className="text-texto">todo mundo</b> que mandar mensagem num chip com “Robô ligado”. Use um número só para vendas, não o seu pessoal.</li>
          <li>• Ele segue o funil marcado como <b className="text-texto">Padrão</b> (e ativo) em Funil, a não ser que o anúncio aponte outro.</li>
          <li>• Se você responder pelo celular, o robô pausa naquela conversa sozinho.</li>
        </ul>
      </Card>

      {qrAberto && <JanelaQr numero={qrAberto.numero} qrInicial={qrAberto.qr} onFechar={() => setQrAberto(null)} />}
    </>
  );
}
