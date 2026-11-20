"use client";

// "Operação ao vivo": saúde dos chips/robô, números de hoje e o feed de fechamentos em tempo real.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/dinheiro";

type Venda = {
  id: string;
  valor_centavos: number;
  criado_em: string;
  pago_em: string | null;
  tipo: string;
  contato: { nome: string | null; telefone: string; numero_id: string | null } | null;
  produto: { nome: string } | null;
};
type Estado = {
  chipsOn: number;
  chipsTotal: number;
  ultimaRecebida: string | null;
  ativasAgora: number;
  conversasHoje: number;
  vendas: Venda[];
  chips: Record<string, string>;
};

const RECUPERADO_MIN = 15; // pago depois dos lembretes = venda recuperada pelo follow-up

function inicioHoje() {
  const agora = new Date(Date.now() - 3 * 3600_000);
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 3));
}
function ha(iso: string | null, agora: number) {
  if (!iso) return "—";
  const s = Math.max(0, (agora - new Date(iso).getTime()) / 1000);
  if (s < 60) return `há ${Math.floor(s)} seg`;
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
function iniciais(n: string) {
  const p = n.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? (p[p.length - 1][0] ?? "") : "")).toUpperCase() || "?";
}
const recuperada = (v: Venda) => v.pago_em && (new Date(v.pago_em).getTime() - new Date(v.criado_em).getTime()) / 60000 > RECUPERADO_MIN;

export function AoVivo() {
  const [e, setE] = useState<Estado | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  const carregar = useCallback(async () => {
    const supabase = createClient();
    const hoje = inicioHoje().toISOString();
    const [nums, ult, ativas, convs, pags] = await Promise.all([
      supabase.from("numeros").select("id, nome, status"),
      supabase.from("mensagens").select("criado_em").eq("autor", "cliente").order("criado_em", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("contatos").select("id", { count: "exact", head: true }).eq("simulacao", false).gte("ultima_msg_em", new Date(Date.now() - 30 * 60_000).toISOString()),
      supabase.from("contatos").select("id", { count: "exact", head: true }).eq("simulacao", false).gte("criado_em", hoje),
      supabase
        .from("pagamentos")
        .select("id, valor_centavos, criado_em, pago_em, tipo, contato:contatos(nome, telefone, numero_id), produto:produtos(nome)")
        .eq("status", "pago")
        .eq("simulacao", false)
        .gte("pago_em", hoje)
        .order("pago_em", { ascending: false })
        .limit(300),
    ]);
    const lista = (nums.data ?? []) as { id: string; nome: string; status: string }[];
    setE({
      chipsOn: lista.filter((n) => n.status === "conectado").length,
      chipsTotal: lista.length,
      ultimaRecebida: (ult.data as { criado_em: string } | null)?.criado_em ?? null,
      ativasAgora: ativas.count ?? 0,
      conversasHoje: convs.count ?? 0,
      vendas: ((pags.data ?? []) as unknown as Venda[]).map((v) => ({
        ...v,
        contato: Array.isArray(v.contato) ? (v.contato[0] ?? null) : v.contato,
        produto: Array.isArray(v.produto) ? (v.produto[0] ?? null) : v.produto,
      })),
      chips: Object.fromEntries(lista.map((n) => [n.id, n.nome])),
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao abrir
    void carregar();
    const supabase = createClient();
    const canal = supabase
      .channel("ao-vivo")
      .on("postgres_changes", { event: "*", schema: "public", table: "pagamentos" }, () => void carregar())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "numeros" }, () => void carregar())
      .subscribe();
    const dados = setInterval(() => void carregar(), 20_000);
    const relogio = setInterval(() => setAgora(Date.now()), 5_000); // atualiza os "há X seg"
    return () => {
      clearInterval(dados);
      clearInterval(relogio);
      void supabase.removeChannel(canal);
    };
  }, [carregar]);

  const vendas = e?.vendas ?? [];
  const principais = vendas.filter((v) => v.tipo !== "upsell");
  const fat = vendas.reduce((t, v) => t + v.valor_centavos, 0);
  const horas = Math.max(1, (agora - inicioHoje().getTime()) / 3600_000);
  const recuperadas = vendas.filter(recuperada);
  const fatRecuperado = recuperadas.reduce((t, v) => t + v.valor_centavos, 0);
  const conversao = e && e.conversasHoje > 0 ? (principais.length / e.conversasHoje) * 100 : 0;
  const recebeuHa = e?.ultimaRecebida ? (agora - new Date(e.ultimaRecebida).getTime()) / 60000 : null;
  const chipsOk = e ? e.chipsTotal > 0 && e.chipsOn === e.chipsTotal : false;

  const pilula = (ok: boolean | null, texto: string, href?: string) => {
    const cls = `inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${
      ok === null ? "border-borda text-suave" : ok ? "border-limao/40 bg-limao/10 text-limao" : "border-[#5a4220] bg-[#241b0e] text-laranja"
    }`;
    const dentro = (
      <>
        <span className={`h-1.5 w-1.5 rounded-full ${ok === null ? "bg-suave" : ok ? "animate-pulse bg-limao" : "bg-laranja"}`} />
        {texto}
      </>
    );
    return href ? (
      <Link href={href} className={cls}>
        {dentro}
      </Link>
    ) : (
      <span className={cls}>{dentro}</span>
    );
  };

  const cartao = "flex min-w-0 flex-col gap-1 rounded-2xl border border-borda bg-fundo/60 p-4";
  return (
    <section aria-label="Operação ao vivo" className="flex flex-col gap-4 rounded-2xl border border-limao/25 bg-cartao p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {pilula(e ? chipsOk : null, e ? (e.chipsTotal ? `${e.chipsOn}/${e.chipsTotal} chips conectados` : "nenhum chip") : "chips…", "/numeros")}
        {pilula(
          e ? (recebeuHa !== null && recebeuHa < 24 * 60) : null,
          e ? (e.ultimaRecebida ? `webhook: última mensagem ${ha(e.ultimaRecebida, agora)}` : "webhook: sem mensagens ainda") : "webhook…",
        )}
        <span className="ml-auto font-mono text-[11px] uppercase tracking-wide text-suave">Hoje · ao vivo</span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        <div className={cartao}>
          <span className="flex items-center justify-between text-xs text-suave">
            Conversas ativas <b className="text-[10px] text-limao">AGORA</b>
          </span>
          <b className="font-titulo text-3xl">{e ? e.ativasAgora : "…"}</b>
          <span className="text-[11px] text-suave">falaram nos últimos 30 min · {e?.conversasHoje ?? "…"} novas hoje</span>
        </div>
        <div className={`${cartao} border-limao/30`}>
          <span className="flex items-center justify-between text-xs text-suave">
            Faturamento hoje {fat > 0 && <b className="text-[10px] text-limao">+{brl(Math.round(fat / horas))}/h</b>}
          </span>
          <b className="font-titulo text-3xl text-limao">{e ? brl(fat) : "…"}</b>
          <span className="text-[11px] text-suave">
            {principais.length} venda{principais.length === 1 ? "" : "s"}
            {vendas.length > principais.length ? ` + ${vendas.length - principais.length} upsell` : ""}
          </span>
        </div>
        <div className={cartao}>
          <span className="text-xs text-suave">Taxa de conversão hoje</span>
          <b className="font-titulo text-3xl">{e ? `${conversao.toFixed(1).replace(".", ",")}%` : "…"}</b>
          <span className="text-[11px] text-suave">vendas ÷ conversas novas de hoje</span>
        </div>
        <div className={`${cartao} border-azul/30`}>
          <span className="flex items-center justify-between text-xs text-suave">
            Pix recuperados <b className="text-[10px] text-azul">FOLLOW-UP</b>
          </span>
          <b className="font-titulo text-3xl text-azul">{e ? brl(fatRecuperado) : "…"}</b>
          <span className="text-[11px] text-suave">
            {recuperadas.length} pago{recuperadas.length === 1 ? "" : "s"} depois dos lembretes (mais de {RECUPERADO_MIN} min após o Pix)
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-borda bg-fundo/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col">
            <b className="text-sm">Fechamentos em tempo real</b>
            <span className="text-[11px] text-suave">Pix confirmados hoje, direto das conversas</span>
          </div>
          <span className="rounded-md border border-limao/40 px-2 py-1 font-mono text-[10px] font-semibold uppercase text-limao">Feed ao vivo</span>
        </div>
        {!e ? (
          <p className="py-4 text-center text-sm text-suave">Carregando…</p>
        ) : vendas.length === 0 ? (
          <p className="py-4 text-center text-sm text-suave">Nenhuma venda hoje ainda. Quando um Pix cair, ele aparece aqui na hora.</p>
        ) : (
          <ul className="flex max-h-[340px] flex-col gap-2 overflow-y-auto pr-1">
            {vendas.slice(0, 30).map((v) => {
              const nome = v.contato?.nome?.trim() || v.contato?.telefone || "Cliente";
              const chip = v.contato?.numero_id ? e.chips[v.contato.numero_id] : null;
              const rec = recuperada(v);
              return (
                <li key={v.id} className="flex items-center gap-3 rounded-xl border border-borda bg-cartao px-3 py-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-limao/15 text-xs font-bold text-limao">{iniciais(nome)}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate text-sm">{nome}</b>
                    <span className="truncate text-[11px] text-suave">
                      {v.produto?.nome ?? "Produto"}
                      {v.tipo === "upsell" ? " (upsell)" : ""}
                      {chip ? ` · ${chip}` : ""}
                    </span>
                  </span>
                  <span
                    className={`hidden rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase sm:inline ${
                      rec ? "border-azul/40 text-azul" : "border-limao/40 text-limao"
                    }`}
                  >
                    {rec ? "Recuperado" : "Pix aprovado"}
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <b className="font-mono text-sm text-limao">{brl(v.valor_centavos)}</b>
                    <span className="text-[10px] text-suave">{ha(v.pago_em, agora)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
