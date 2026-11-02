"use client";

// API de Conversões do Meta: devolve Lead, Pix gerado e Compra ao Pixel para o Meta otimizar por venda.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui";
import { brl } from "@/lib/dinheiro";

const inputCls =
  "w-full min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";
const btnPri = "min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60";
const btnSec = "min-h-11 rounded-[10px] border border-borda bg-cartao px-4 text-sm hover:bg-elevado disabled:opacity-60";

type Config = {
  pixel_id: string;
  pixel_nome: string | null;
  test_code: string | null;
  ev_lead: boolean;
  ev_checkout: boolean;
  ev_compra: boolean;
  ativo: boolean;
  erro: string | null;
  ultimo_envio: string | null;
};
type Evento = { id: number; evento: string; valor_centavos: number | null; status: string; resposta: string | null; criado_em: string };

const NOME: Record<string, string> = { Lead: "Lead (conversa de anúncio)", InitiateCheckout: "Pix gerado", Purchase: "Compra" };
const COR: Record<string, string> = { enviado: "text-limao", pendente: "text-suave", erro: "text-vermelho", ignorado: "text-suave" };

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke("conversoes/painel", { body: corpo });
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

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function AbaConversoes() {
  const [cfg, setCfg] = useState<Config | null | undefined>(undefined);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [pixel, setPixel] = useState("");
  const [token, setToken] = useState("");
  const [teste, setTeste] = useState("");
  const [editar, setEditar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const supabase = createClient();
    const [c, e] = await Promise.all([
      supabase.from("capi_config").select("pixel_id, pixel_nome, test_code, ev_lead, ev_checkout, ev_compra, ativo, erro, ultimo_envio").maybeSingle(),
      supabase.from("capi_eventos").select("id, evento, valor_centavos, status, resposta, criado_em").order("criado_em", { ascending: false }).limit(15),
    ]);
    setCfg((c.data as Config) ?? null);
    setEventos((e.data ?? []) as Evento[]);
    if (c.data) {
      setPixel(c.data.pixel_id);
      setTeste(c.data.test_code ?? "");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao abrir
    void carregar();
  }, [carregar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setOcupado(true);
    try {
      const r = await chamar<{ pixel_nome: string | null }>({ acao: "salvar", pixel_id: pixel, token, test_code: teste });
      setToken("");
      setEditar(false);
      setMsg({ ok: true, texto: `Pixel ${r.pixel_nome ? `“${r.pixel_nome}” ` : ""}conectado. A partir de agora cada conversa, Pix e venda vai para o Meta.` });
      await carregar();
    } catch (err) {
      setMsg({ ok: false, texto: (err as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  async function testar() {
    setMsg(null);
    setOcupado(true);
    try {
      await chamar({ acao: "testar" });
      setMsg({ ok: true, texto: "Evento de teste enviado! Confira na aba “Testar eventos” do Gerenciador de Eventos (aparece em alguns segundos)." });
    } catch (err) {
      setMsg({ ok: false, texto: (err as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  async function alternar(campo: "ev_lead" | "ev_checkout" | "ev_compra" | "ativo") {
    if (!cfg) return;
    const novo = !cfg[campo];
    setCfg({ ...cfg, [campo]: novo });
    await createClient().from("capi_config").update({ [campo]: novo }).neq("pixel_id", "");
  }

  async function salvarTeste() {
    await createClient().from("capi_config").update({ test_code: teste.trim() || null }).neq("pixel_id", "");
    setMsg({ ok: true, texto: teste.trim() ? "Código de teste salvo: os eventos aparecem em “Testar eventos”." : "Código de teste removido: eventos seguem normais." });
    await carregar();
  }

  async function remover() {
    if (!window.confirm("Desconectar o Pixel? O XClozr para de mandar as vendas para o Meta.")) return;
    await chamar({ acao: "remover" });
    await carregar();
  }

  if (cfg === undefined) return <p className="text-sm text-suave">Carregando…</p>;
  const form = !cfg || editar;

  return (
    <>
      <Card title="📡 API de Conversões do Meta">
        <p className="text-sm text-suave">
          É o que a Utmify e as ferramentas grandes fazem: cada venda que o robô fecha volta para o Meta como uma <b className="text-texto">Compra</b>, com o valor. Assim o Meta
          aprende quem compra de verdade (não só quem conversa), mostra as vendas no Gerenciador de Anúncios e entrega seus anúncios para pessoas parecidas com quem pagou.
        </p>
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          {[
            ["Lead", "Alguém chegou no WhatsApp por um anúncio"],
            ["Pix gerado", "O robô gerou o Pix (InitiateCheckout)"],
            ["Compra", "O Pix foi pago, com o valor (Purchase)"],
          ].map(([t, d]) => (
            <div key={t} className="rounded-xl border border-borda bg-fundo p-3">
              <b>{t}</b>
              <span className="block text-xs text-suave">{d}</span>
            </div>
          ))}
        </div>

        {cfg && !editar && (
          <div className="flex flex-col gap-3 rounded-xl border border-borda bg-fundo p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                Pixel <b>{cfg.pixel_nome ?? cfg.pixel_id}</b> <span className="text-suave">({cfg.pixel_id})</span>
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${!cfg.ativo ? "bg-elevado text-suave" : cfg.erro ? "bg-[#241b0e] text-laranja" : "bg-limao/15 text-limao"}`}>
                {!cfg.ativo ? "● Pausado" : cfg.erro ? "● Com erro" : "● Ativo"}
              </span>
            </div>
            {cfg.erro && <p className="text-sm text-laranja">Último erro do Meta: {cfg.erro}</p>}
            <p className="text-xs text-suave">Último envio: {cfg.ultimo_envio ? quando(cfg.ultimo_envio) : "ainda nenhum"}</p>
            <div className="flex flex-wrap gap-4 text-sm">
              {(
                [
                  ["ativo", "Enviar eventos"],
                  ["ev_lead", "Lead"],
                  ["ev_checkout", "Pix gerado"],
                  ["ev_compra", "Compra"],
                ] as const
              ).map(([k, nome]) => (
                <label key={k} className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-[#5ed98c]" checked={cfg[k]} onChange={() => void alternar(k)} />
                  {nome}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-suave">Código de teste (opcional)</span>
                <input className={`${inputCls} w-48`} value={teste} onChange={(e) => setTeste(e.target.value)} placeholder="TEST12345" />
              </label>
              <button type="button" onClick={() => void salvarTeste()} className={btnSec}>
                Salvar código
              </button>
              <button type="button" onClick={() => void testar()} disabled={ocupado} className={btnSec}>
                {ocupado ? "Enviando…" : "Enviar evento de teste"}
              </button>
              <button type="button" onClick={() => setEditar(true)} className="min-h-11 px-3 text-sm text-limao hover:underline">
                Trocar Pixel/token
              </button>
              <button type="button" onClick={() => void remover()} className="min-h-11 px-3 text-sm text-suave hover:text-vermelho">
                Desconectar
              </button>
            </div>
            <p className="text-[11px] text-suave">
              Enquanto houver código de teste, os eventos vão só para a aba “Testar eventos” e não contam nos anúncios. Apague o código depois de conferir.
            </p>
          </div>
        )}

        {form && (
          <>
            <ol className="flex flex-col gap-1.5 rounded-xl border border-borda bg-fundo p-4 text-sm text-suave">
              <li>
                1. Abra o <b className="text-texto">Gerenciador de Eventos</b> (business.facebook.com/events_manager) e escolha seu Pixel (ou clique em{" "}
                <b className="text-texto">Conectar fontes de dados → Web</b> para criar um). Use o mesmo portfólio das suas contas de anúncio.
              </li>
              <li>
                2. Copie o <b className="text-texto">ID do Pixel</b> (o número embaixo do nome).
              </li>
              <li>
                3. Vá em <b className="text-texto">Configurações</b> do Pixel → <b className="text-texto">API de Conversões</b> → <b className="text-texto">Gerar token de acesso</b>.
                Copie o token.
              </li>
              <li>4. Cole os dois abaixo. Os dois ficam guardados só no servidor.</li>
            </ol>
            <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
              <input className={inputCls} value={pixel} onChange={(e) => setPixel(e.target.value)} placeholder="ID do Pixel" inputMode="numeric" required />
              <input
                className={inputCls}
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={cfg ? "Novo token (deixe vazio para manter)" : "Token da API de Conversões"}
                autoComplete="off"
                required={!cfg}
              />
              <button type="submit" disabled={ocupado} className={btnPri}>
                {ocupado ? "Conferindo…" : "Conectar"}
              </button>
            </form>
            {editar && (
              <button type="button" onClick={() => setEditar(false)} className="self-start text-xs text-suave hover:text-texto">
                cancelar
              </button>
            )}
          </>
        )}
        {msg && <p className={`text-sm ${msg.ok ? "text-limao" : "text-vermelho"}`}>{msg.texto}</p>}
      </Card>

      {cfg && (
        <Card title="Últimos eventos enviados">
          {eventos.length === 0 ? (
            <p className="text-sm text-suave">Nenhum evento ainda. Eles aparecem aqui quando chegar conversa de anúncio, Pix gerado ou venda.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-borda text-sm">
              {eventos.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className={COR[e.status] ?? "text-suave"}>{e.status === "enviado" ? "✓" : e.status === "erro" ? "✕" : "•"}</span>
                  <span className="font-medium">{NOME[e.evento] ?? e.evento}</span>
                  {e.valor_centavos != null && <span className="text-suave">{brl(e.valor_centavos)}</span>}
                  <span className="text-xs text-suave">{e.status === "pendente" ? "na fila (sai em até 1 min)" : e.status}</span>
                  {e.resposta && e.status !== "enviado" && <span className="text-xs text-laranja">{e.resposta}</span>}
                  <span className="ml-auto text-xs text-suave">{quando(e.criado_em)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card title="Depois de conectar: otimizar por venda">
        <p className="text-sm text-suave">
          Com as compras chegando no Pixel, elas passam a aparecer nos relatórios do Meta e o algoritmo usa esse sinal para entender quem compra. Teste também uma campanha com
          objetivo <b className="text-texto">Vendas</b> otimizando pelo evento <b className="text-texto">Compra</b> desse Pixel (o Meta mostra as opções disponíveis para a sua
          conta) e compare o custo por venda com a campanha de conversas. Nos primeiros dias, confira no Gerenciador de Eventos se as compras estão chegando e a qualidade de
          correspondência dos eventos.
        </p>
      </Card>
    </>
  );
}
