"use client";

// Resumo do tráfego em cartões (estilo Utmify): soma das campanhas filtradas/selecionadas no período
import { brl } from "@/lib/dinheiro";
import type { Linha } from "./api";
import { somar } from "./colunas";

const div = (a: number, b: number) => (b > 0 ? a / b : null);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
const vezes = (v: number | null) => (v === null ? "—" : v.toFixed(2).replace(".", ","));
const dinheiro = (v: number | null) => (v === null ? "—" : brl(Math.round(v)));

type Cartao = { nome: string; valor: string; dica: string; tom?: "bom" | "ruim" | "neutro" };

function Kpi({ c, grande }: { c: Cartao; grande?: boolean }) {
  const cor = c.tom === "bom" ? "text-limao" : c.tom === "ruim" ? "text-vermelho" : "text-texto";
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-borda bg-cartao p-4" title={c.dica}>
      <span className={`flex items-center justify-between text-[13px] ${c.tom && c.tom !== "neutro" ? cor : "text-suave"}`}>
        {c.nome}
        <span className="cursor-help text-xs text-suave" aria-label={c.dica}>
          ⓘ
        </span>
      </span>
      <span className={`${grande ? "text-2xl" : "text-xl"} font-bold tabular-nums ${cor}`}>{c.valor}</span>
    </div>
  );
}

const CORES = ["#5ed98c", "#4f7cff", "#f5b041", "#e05d6f", "#8b8fa3"];

/** Rosca das vendas por campanha (top 4 + outras). */
function Rosca({ linhas }: { linhas: Linha[] }) {
  const ordenadas = [...linhas].filter((l) => l.vendas > 0).sort((a, b) => b.vendas - a.vendas);
  const fatias = ordenadas.slice(0, 4).map((l) => ({ nome: l.nome, v: l.vendas }));
  const resto = ordenadas.slice(4).reduce((s, l) => s + l.vendas, 0);
  if (resto) fatias.push({ nome: "Outras", v: resto });
  const total = fatias.reduce((s, f) => s + f.v, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let acumulado = 0;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-borda bg-cartao p-4 lg:row-span-2">
      <span className="text-[13px] text-suave">Vendas por campanha</span>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 sm:flex-row lg:flex-col">
        <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label={`Total de ${total} vendas`}>
          <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-elevado, #23262e)" strokeWidth="18" />
          {total > 0 &&
            fatias.map((f, i) => {
              const parte = (f.v / total) * C;
              const el = (
                <circle
                  key={f.nome}
                  cx="70"
                  cy="70"
                  r={R}
                  fill="none"
                  stroke={CORES[i % CORES.length]}
                  strokeWidth="18"
                  strokeDasharray={`${parte} ${C - parte}`}
                  strokeDashoffset={-acumulado}
                  transform="rotate(-90 70 70)"
                />
              );
              acumulado += parte;
              return el;
            })}
          <text x="70" y="64" textAnchor="middle" className="fill-current text-suave" fontSize="11">
            Total
          </text>
          <text x="70" y="84" textAnchor="middle" className="fill-current" fontSize="20" fontWeight="700">
            {total}
          </text>
        </svg>
        <ul className="flex w-full flex-col gap-1.5 text-xs">
          {total === 0 && <li className="text-center text-suave">Nenhuma venda no período</li>}
          {fatias.map((f, i) => (
            <li key={f.nome} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CORES[i % CORES.length] }} />
              <span className="truncate" title={f.nome}>
                {f.nome}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-suave">
                {f.v} · {Math.round((f.v / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ResumoTrafego({ campanhas }: { campanhas: Linha[] }) {
  const s = somar(campanhas);
  const custoAnuncio = s.gasto + s.imposto_meta;
  const liquido = s.faturamento - s.taxas;
  const roas = div(s.faturamento, custoAnuncio);
  const roi = div(s.lucro, custoAnuncio);
  const margem = div(s.lucro, s.faturamento);
  const pendentes = Math.max(0, s.pix - s.vendas);
  const tom = (v: number | null) => (v === null || v === 0 ? "neutro" : v > 0 ? "bom" : "ruim") as Cartao["tom"];

  const principais: Cartao[] = [
    { nome: "Faturamento líquido", valor: dinheiro(liquido), dica: "Tudo que foi pago (produto + upsell) menos a taxa do gateway" },
    { nome: "Gastos com anúncios", valor: dinheiro(custoAnuncio), dica: "Gasto no Meta + imposto do Meta configurado em ⚙" },
    { nome: "ROAS", valor: vezes(roas), dica: "Faturamento ÷ gasto com anúncio. Acima de 1 o anúncio se paga antes dos outros custos", tom: roas === null ? "neutro" : s.lucro >= 0 ? "bom" : "ruim" },
    { nome: "Lucro", valor: dinheiro(s.lucro), dica: "Faturamento − gasto − imposto do Meta − taxas − custo de produto − imposto sobre venda", tom: tom(s.lucro) },
  ];
  const outros: Cartao[] = [
    { nome: "Vendas", valor: s.vendas.toLocaleString("pt-BR"), dica: "Pix do produto principal pagos" },
    { nome: "ROI", valor: pct(roi), dica: "Lucro ÷ gasto com anúncio", tom: tom(roi) },
    { nome: "Margem de lucro", valor: pct(margem), dica: "Lucro ÷ faturamento", tom: tom(margem) },
    { nome: "CPA", valor: dinheiro(div(s.gasto, s.vendas)), dica: "Gasto ÷ vendas (quanto custa cada venda)" },
    { nome: "Pix pendentes", valor: pendentes.toLocaleString("pt-BR"), dica: "Pix gerados que ainda não foram pagos (o robô segue tentando recuperar)" },
    { nome: "Ticket médio", valor: dinheiro(div(s.faturamento, s.vendas)), dica: "Faturamento ÷ vendas (com upsell)" },
    { nome: "Upsells", valor: `${s.upsells} · ${dinheiro(s.faturamento_upsell)}`, dica: "Upsells pagos e quanto eles faturaram" },
    { nome: "Impostos", valor: dinheiro(s.imposto_meta + s.imposto_venda), dica: "Imposto do Meta + imposto sobre venda (configurados em ⚙)" },
    { nome: "Custo por conversa", valor: dinheiro(div(s.gasto, s.contatos || s.conversas)), dica: "Gasto ÷ pessoas que chegaram no WhatsApp" },
    { nome: "Conversão", valor: pct(div(s.vendas, s.contatos)), dica: "Vendas ÷ pessoas que chegaram no WhatsApp" },
  ];

  return (
    <section className="flex flex-col gap-3" aria-label="Resumo">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {principais.map((c) => (
          <Kpi key={c.nome} c={c} grande />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Rosca linhas={campanhas} />
        {outros.map((c) => (
          <Kpi key={c.nome} c={c} />
        ))}
      </div>
    </section>
  );
}
