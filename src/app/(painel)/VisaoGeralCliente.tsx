"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { brl } from "@/lib/dinheiro";

type Dia = { dia: string; faturamento: number; gasto: number };
type Anuncio = { nome: string; faturamento: number; taxas: number; gasto: number; vendas: number; contatos: number };
type Metricas = {
  faturamento: number;
  taxas: number;
  gasto: number;
  vendas: number;
  vendas_total: number;
  contatos: number;
  ativas_hoje: number;
  abordados: number;
  responderam: number;
  tempo_resposta_seg: number | null;
  msgs_enviadas: number;
  msgs_recebidas: number;
  funil: { conversas: number; pix_gerados: number; pix_pagos: number; upsell: number };
  por_dia: Dia[];
  por_anuncio: Anuncio[];
};

type Periodo = "hoje" | "7d" | "30d" | "mes";
const PERIODOS: { v: Periodo; nome: string }[] = [
  { v: "hoje", nome: "Hoje" },
  { v: "7d", nome: "7 dias" },
  { v: "30d", nome: "30 dias" },
  { v: "mes", nome: "Este mês" },
];

// início do dia em Brasília (UTC-3)
function inicioDiaBrasilia(diasAtras = 0) {
  const agora = new Date();
  const b = new Date(agora.getTime() - 3 * 3600_000);
  const meiaNoite = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() - diasAtras, 3, 0, 0);
  return new Date(meiaNoite);
}

function intervalo(p: Periodo) {
  const fim = new Date(Date.now() + 60_000);
  if (p === "hoje") return { inicio: inicioDiaBrasilia(0), fim };
  if (p === "7d") return { inicio: inicioDiaBrasilia(6), fim };
  if (p === "30d") return { inicio: inicioDiaBrasilia(29), fim };
  const b = new Date(Date.now() - 3 * 3600_000);
  return { inicio: new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 1, 3)), fim };
}

function tempo(seg: number | null) {
  if (seg === null || seg === undefined) return "—";
  if (seg < 60) return `${seg}s`;
  const m = Math.floor(seg / 60);
  return `${m}min ${seg % 60}s`;
}

function pct(a: number, b: number) {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : "—";
}

function Grafico({ dias }: { dias: Dia[] }) {
  const max = Math.max(1, ...dias.map((d) => Math.max(d.faturamento, d.gasto)));
  const temDados = dias.some((d) => d.faturamento > 0 || d.gasto > 0);
  if (!temDados) return <EmptyState title="Ainda sem dados" text="O gráfico aparece quando o robô começar a vender e a conta de anúncios estiver conectada." />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-4 text-xs text-suave">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-limao" /> Faturamento
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-laranja" /> Gasto
        </span>
      </div>
      <div className="flex h-48 items-end gap-1.5">
        {dias.map((d) => (
          <div key={d.dia} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
            <div className="flex h-full items-end justify-center gap-0.5">
              <div className="w-1/2 max-w-4 rounded-t bg-limao" style={{ height: `${(d.faturamento / max) * 100}%` }} />
              <div className="w-1/2 max-w-4 rounded-t bg-laranja" style={{ height: `${(d.gasto / max) * 100}%` }} />
            </div>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-borda bg-elevado px-2 py-1 text-[11px] group-hover:block">
              {d.dia.split("-").reverse().slice(0, 2).join("/")} · {brl(d.faturamento)} / {brl(d.gasto)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-suave">
        <span>{dias[0]?.dia.split("-").reverse().slice(0, 2).join("/")}</span>
        <span>{dias[dias.length - 1]?.dia.split("-").reverse().slice(0, 2).join("/")}</span>
      </div>
    </div>
  );
}

export function VisaoGeralCliente() {
  const [periodo, setPeriodo] = useState<Periodo>("hoje");
  const [m, setM] = useState<Metricas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carregar = useCallback(async (p: Periodo) => {
    const { inicio, fim } = intervalo(p);
    const { data, error } = await createClient().rpc("metricas_painel", { p_inicio: inicio.toISOString(), p_fim: fim.toISOString() });
    if (error) setErro("Não consegui carregar as métricas.");
    else {
      setErro(null);
      setM(data as Metricas);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega os dados ao abrir/trocar o período
    void carregar(periodo);
    const supabase = createClient();
    const atualizar = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void carregar(periodo), 1500);
    };
    const canal = supabase
      .channel(`visao-geral-${periodo}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensagens" }, atualizar)
      .on("postgres_changes", { event: "*", schema: "public", table: "contatos" }, atualizar)
      .subscribe();
    const intervaloId = setInterval(() => void carregar(periodo), 60_000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      clearInterval(intervaloId);
      void supabase.removeChannel(canal);
    };
  }, [periodo, carregar]);

  const lucro = m ? m.faturamento - m.taxas - m.gasto : 0;
  const etapas = m
    ? [
        { nome: "Conversas iniciadas", v: m.funil.conversas },
        { nome: "Pix gerados", v: m.funil.pix_gerados },
        { nome: "Pix pagos", v: m.funil.pix_pagos },
        { nome: "Compraram o upsell", v: m.funil.upsell },
      ]
    : [];
  const topo = Math.max(1, ...etapas.map((e) => e.v));
  const v = (x: string) => (m ? x : "…");

  return (
    <>
      <PageHeader
        title="Visão geral"
        subtitle="Quanto você gastou, vendeu e lucrou nos anúncios"
        actions={
          <div className="flex rounded-[10px] border border-borda bg-cartao p-1" role="group" aria-label="Período">
            {PERIODOS.map((p) => (
              <button
                key={p.v}
                type="button"
                onClick={() => setPeriodo(p.v)}
                aria-pressed={periodo === p.v}
                className={`min-h-9 rounded-lg px-3 text-sm ${periodo === p.v ? "bg-limao font-bold text-fundo" : "text-suave hover:text-texto"}`}
              >
                {p.nome}
              </button>
            ))}
          </div>
        }
      />

      {erro && <p className="text-sm text-vermelho">{erro}</p>}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        <Stat label="Faturamento" value={v(brl(m?.faturamento ?? 0))} hint={m && m.vendas_total > 0 ? `${m.vendas_total} venda(s) paga(s)` : "aguardando as primeiras vendas"} />
        <Stat label="Gasto em anúncios" value={v(brl(m?.gasto ?? 0))} hint={m && m.gasto > 0 ? "no período" : "conecte a conta Meta Ads"} />
        <Stat label="Lucro líquido" value={v(brl(lucro))} hint="descontando gasto e taxas do gateway" />
        <Stat label="ROAS" value={v(m && m.gasto > 0 ? `${(m.faturamento / m.gasto).toFixed(2).replace(".", ",")}x` : "—")} />
        <Stat label="CPA (custo por venda)" value={v(m && m.gasto > 0 && m.vendas > 0 ? brl(Math.round(m.gasto / m.vendas)) : "—")} />
      </div>

      <section aria-labelledby="atendimento" className="flex flex-col gap-3">
        <h2 id="atendimento" className="text-base font-semibold">
          Atendimento
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
          <Stat label="Total de contatos" value={v(String(m?.contatos ?? 0))} hint="novos no período" />
          <Stat label="Conversas ativas hoje" value={v(String(m?.ativas_hoje ?? 0))} hint="em tempo real" />
          <Stat label="Taxa de resposta" value={v(pct(m?.responderam ?? 0, m?.abordados ?? 0))} hint="responderam ao robô" />
          <Stat label="Tempo médio de resposta" value={v(tempo(m?.tempo_resposta_seg ?? null))} hint="do robô ao cliente" />
          <Stat label="Mensagens enviadas" value={v(String(m?.msgs_enviadas ?? 0))} hint="robô + humano" />
          <Stat label="Mensagens recebidas" value={v(String(m?.msgs_recebidas ?? 0))} hint="dos clientes" />
          <Stat label="Ticket médio" value={v(m && m.vendas_total > 0 ? brl(Math.round(m.faturamento / m.vendas_total)) : "R$ 0,00")} hint="por venda paga" />
          <Stat label="Atendimentos concluídos" value={v(String(m?.vendas ?? 0))} hint="venda paga e entregue" />
        </div>
      </section>

      <div className="flex flex-wrap gap-4">
        <Card title="Funil de vendas" className="min-w-0 flex-[1_1_420px]">
          <ul className="flex flex-col gap-4">
            {(m ? etapas : [{ nome: "Conversas iniciadas", v: 0 }, { nome: "Pix gerados", v: 0 }, { nome: "Pix pagos", v: 0 }, { nome: "Compraram o upsell", v: 0 }]).map((e, i, arr) => (
              <li key={e.nome} className="flex flex-col gap-2">
                <div className="flex justify-between text-sm">
                  <span>{e.nome}</span>
                  <span className="font-semibold">
                    {m ? e.v : "…"}
                    {m && i > 0 && arr[i - 1].v > 0 && <span className="ml-2 text-xs font-normal text-suave">{pct(e.v, arr[i - 1].v)}</span>}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-md bg-elevado">
                  <div className="h-full rounded-md bg-limao transition-all" style={{ width: `${(e.v / topo) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Faturamento x gasto por dia" className="min-w-0 flex-[1_1_420px]">
          {m ? <Grafico dias={m.por_dia} /> : <p className="text-sm text-suave">Carregando…</p>}
        </Card>
      </div>

      <Card title="Lucro por anúncio">
        {!m || m.por_anuncio.length === 0 ? (
          <EmptyState
            title="Nenhum anúncio rastreado"
            text="Crie um link de rastreio em Anúncios e use no seu anúncio para ver o lucro de cada um aqui."
            action={
              <Link href="/anuncios" className="text-sm font-semibold text-limao">
                Ir para Anúncios →
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-suave">
                  <th className="py-2 font-medium">Anúncio</th>
                  <th className="py-2 text-right font-medium">Contatos</th>
                  <th className="py-2 text-right font-medium">Vendas</th>
                  <th className="py-2 text-right font-medium">Faturamento</th>
                  <th className="py-2 text-right font-medium">Gasto</th>
                  <th className="py-2 text-right font-medium">Lucro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {m.por_anuncio.map((a) => {
                  const l = a.faturamento - a.taxas - a.gasto;
                  return (
                    <tr key={a.nome}>
                      <td className="py-2.5">{a.nome}</td>
                      <td className="py-2.5 text-right">{a.contatos}</td>
                      <td className="py-2.5 text-right">{a.vendas}</td>
                      <td className="py-2.5 text-right">{brl(a.faturamento)}</td>
                      <td className="py-2.5 text-right">{brl(a.gasto)}</td>
                      <td className={`py-2.5 text-right font-semibold ${l >= 0 ? "text-limao" : "text-vermelho"}`}>{brl(l)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
