"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, PageHeader, Stat } from "@/components/ui";

type Provedor = "openai" | "anthropic" | "gemini";
type Status = { configurada: boolean; provedor: Provedor | null; modelo: string | null; final_chave: string | null; padroes: Record<Provedor, string> };

const PROVEDORES: { v: Provedor; nome: string; empresa: string; ondeChave: string; link: string; sugestoes: string[]; dica: string }[] = [
  {
    v: "openai",
    nome: "ChatGPT",
    empresa: "OpenAI",
    ondeChave: "platform.openai.com → API keys",
    link: "https://platform.openai.com/api-keys",
    sugestoes: ["gpt-5.4-mini", "gpt-5.4-nano", "gpt-5-mini", "gpt-4.1-mini"],
    dica: "O mais usado em robôs de venda. O “mini” é barato e rápido.",
  },
  {
    v: "anthropic",
    nome: "Claude",
    empresa: "Anthropic",
    ondeChave: "console.anthropic.com → API Keys",
    link: "https://console.anthropic.com/settings/keys",
    sugestoes: ["claude-haiku-5-5", "claude-sonnet-5-5"],
    dica: "Ótimo em português e em seguir as regras do roteiro.",
  },
  {
    v: "gemini",
    nome: "Gemini",
    empresa: "Google",
    ondeChave: "aistudio.google.com → Get API key",
    link: "https://aistudio.google.com/app/apikey",
    sugestoes: ["gemini-flash-latest", "gemini-flash-lite-latest"],
    dica: "Tem cota gratuita para começar.",
  },
];

const inputCls =
  "w-full min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke("motor/ia", { body: corpo });
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

export function IaCliente() {
  const [status, setStatus] = useState<Status | null>(null);
  const [editando, setEditando] = useState(false);
  const [provedor, setProvedor] = useState<Provedor>("openai");
  const [modelo, setModelo] = useState("");
  const [chave, setChave] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [uso, setUso] = useState<{ respostas: number; entrada: number; saida: number; hoje: number } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const s = await chamar<Status>({ acao: "status" });
      setStatus(s);
      if (s.provedor) {
        setProvedor(s.provedor);
        setModelo(s.modelo ?? "");
      }
    } catch (e) {
      setErro((e as Error).message);
    }
    const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data } = await createClient().from("ia_uso").select("tokens_entrada, tokens_saida, criado_em").gte("criado_em", desde).limit(10000);
    const linhas = (data ?? []) as { tokens_entrada: number; tokens_saida: number; criado_em: string }[];
    const hoje = new Date().toDateString();
    setUso({
      respostas: linhas.length,
      entrada: linhas.reduce((a, l) => a + l.tokens_entrada, 0),
      saida: linhas.reduce((a, l) => a + l.tokens_saida, 0),
      hoje: linhas.filter((l) => new Date(l.criado_em).toDateString() === hoje).length,
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao abrir a página
    void carregar();
  }, [carregar]);

  const atual = PROVEDORES.find((p) => p.v === provedor)!;
  const aberto = editando || (status !== null && !status.configurada);
  const mesmoProvedor = status?.configurada && status.provedor === provedor;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setOk(false);
    setSalvando(true);
    try {
      await chamar({ acao: "salvar", provedor, modelo: modelo.trim() || status?.padroes?.[provedor] || atual.sugestoes[0], chave });
      setChave("");
      setEditando(false);
      setOk(true);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function remover() {
    setErro(null);
    await chamar({ acao: "apagar" }).catch((e) => setErro((e as Error).message));
    setOk(false);
    await carregar();
  }

  const nomeAtual = PROVEDORES.find((p) => p.v === status?.provedor);

  return (
    <>
      <PageHeader title="Agente de IA" subtitle="Ligue uma IA para conversar com o cliente dentro do funil" />

      {status === null && !erro && <p className="text-sm text-suave">Carregando…</p>}

      {status?.configurada && !aberto && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-limao/40 bg-limao-escuro px-5 py-4 text-sm">
          <span className="h-2.5 w-2.5 rounded-full bg-limao" />
          <span className="font-semibold text-limao">IA ligada</span>
          <span className="text-texto">
            {nomeAtual?.nome} ({nomeAtual?.empresa}) · <code className="text-[13px]">{status.modelo}</code> · chave ••••{status.final_chave}
          </span>
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={() => setEditando(true)} className="min-h-9 rounded-lg px-3 text-xs text-texto hover:bg-elevado">
              Trocar
            </button>
            <button type="button" onClick={remover} className="min-h-9 rounded-lg px-3 text-xs text-suave hover:text-vermelho">
              Desligar
            </button>
          </span>
        </div>
      )}
      {ok && <p className="text-sm text-limao">Chave testada e salva. A IA já pode ser usada nos funis.</p>}

      {aberto && status && (
        <Card title="Escolha a IA">
          <form onSubmit={salvar} className="flex flex-col gap-5">
            <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="IA">
              {PROVEDORES.map((p) => (
                <button
                  key={p.v}
                  type="button"
                  role="radio"
                  aria-checked={provedor === p.v}
                  onClick={() => {
                    setProvedor(p.v);
                    setModelo(status.provedor === p.v ? (status.modelo ?? "") : "");
                  }}
                  className={`flex flex-col gap-1 rounded-xl border p-4 text-left ${provedor === p.v ? "border-limao bg-limao-escuro" : "border-borda bg-fundo hover:bg-elevado"}`}
                >
                  <span className="text-sm font-semibold">{p.nome}</span>
                  <span className="text-xs text-suave">{p.empresa}</span>
                  <span className="mt-1 text-xs text-suave">{p.dica}</span>
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-[13px] text-suave">
                Modelo
                <input
                  className={inputCls}
                  list={`modelos-${provedor}`}
                  value={modelo}
                  onChange={(e) => setModelo(e.target.value)}
                  placeholder={status.padroes?.[provedor] ?? atual.sugestoes[0]}
                  autoComplete="off"
                />
                <datalist id={`modelos-${provedor}`}>
                  {atual.sugestoes.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <span className="text-[11px]">Deixe vazio para usar o recomendado.</span>
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] text-suave">
                Chave de API
                <input
                  className={inputCls}
                  type="password"
                  value={chave}
                  onChange={(e) => setChave(e.target.value)}
                  placeholder={mesmoProvedor ? "deixe vazio para manter a atual" : "cole a chave aqui"}
                  required={!mesmoProvedor}
                  autoComplete="off"
                />
                <span className="text-[11px]">
                  Pegue em{" "}
                  <a href={atual.link} target="_blank" rel="noreferrer" className="text-azul hover:underline">
                    {atual.ondeChave}
                  </a>
                  . Fica guardada só no servidor.
                </span>
              </label>
            </div>

            {erro && <p className="text-sm text-vermelho">{erro}</p>}

            <div className="flex gap-2">
              <button type="submit" disabled={salvando} className="min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60">
                {salvando ? "Testando a chave…" : "Testar e salvar"}
              </button>
              {status.configurada && (
                <button type="button" onClick={() => setEditando(false)} className="min-h-11 rounded-[10px] border border-borda bg-cartao px-4 text-sm hover:bg-elevado">
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        <Stat label="Respostas da IA hoje" value={uso ? String(uso.hoje) : "…"} />
        <Stat label="Respostas (30 dias)" value={uso ? String(uso.respostas) : "…"} />
        <Stat label="Tokens lidos (30 dias)" value={uso ? uso.entrada.toLocaleString("pt-BR") : "…"} hint="histórico da conversa + instruções" />
        <Stat label="Tokens escritos (30 dias)" value={uso ? uso.saida.toLocaleString("pt-BR") : "…"} hint="o custo exato aparece no painel da IA" />
      </div>

      <Card title="Como usar no funil">
        <ol className="flex flex-col gap-2 text-sm text-suave">
          <li>
            1. Em <Link href="/funil" className="text-limao hover:underline">Funil</Link>, adicione o bloco <b className="text-texto">Agente IA</b> (grupo Avançado).
          </li>
          <li>
            2. Escreva <b className="text-texto">quem é a IA</b> (ex.: “Você é a Ana, vendedora do Guia X”), as <b className="text-texto">informações do produto</b> (preço, o que inclui, garantia) e{" "}
            <b className="text-texto">quando ela termina</b> (ex.: “quando o cliente disser que quer comprar”).
          </li>
          <li>
            3. Ligue a saída <b className="text-limao">Objetivo concluído</b> no bloco <b className="text-texto">Gerar Pix</b>, e <b className="text-laranja">Limite atingido</b> em “Chamar humano” ou numa mensagem.
          </li>
          <li>4. Use “▶ Testar funil” para conversar com a IA antes de ativar. O teste também gasta tokens.</li>
        </ol>
        <p className="text-xs text-suave">
          A IA só fala o que estiver nas informações do produto. Ela nunca manda Pix ou link: quando o cliente decide comprar, o funil segue para o seu bloco de Pix.
        </p>
      </Card>
    </>
  );
}
