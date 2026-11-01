import type { Metadata } from "next";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Visão geral" };

const etapas = ["Conversas iniciadas", "Pix gerados", "Pix pagos", "Compraram o upsell"];

export default function VisaoGeralPage() {
  return (
    <>
      <PageHeader title="Visão geral" subtitle="Quanto você gastou, vendeu e lucrou nos anúncios" />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        <Stat label="Faturamento" value="R$ 0,00" hint="aguardando as primeiras vendas" />
        <Stat label="Gasto em anúncios" value="R$ 0,00" hint="conecte a conta Meta Ads" />
        <Stat label="Lucro líquido" value="R$ 0,00" hint="descontando gateway e IA" />
        <Stat label="ROAS" value="—" />
        <Stat label="CPA (custo por venda)" value="—" />
      </div>

      <section aria-labelledby="atendimento" className="flex flex-col gap-3">
        <h2 id="atendimento" className="text-base font-semibold">
          Atendimento
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
          <Stat label="Total de contatos" value="0" hint="no período" />
          <Stat label="Conversas ativas hoje" value="0" hint="em tempo real" />
          <Stat label="Taxa de resposta" value="0%" hint="responderam a 1ª mensagem" />
          <Stat label="Tempo médio de resposta" value="0s" hint="do robô ao cliente" />
          <Stat label="Mensagens enviadas" value="0" hint="robô + humano" />
          <Stat label="Mensagens recebidas" value="0" hint="dos clientes" />
          <Stat label="Ticket médio" value="R$ 0,00" hint="por venda paga" />
          <Stat label="Atendimentos concluídos" value="0" hint="venda paga e entregue" />
        </div>
      </section>

      <div className="flex flex-wrap gap-4">
        <Card title="Funil de vendas" className="min-w-0 flex-[1_1_420px]">
          <ul className="flex flex-col gap-4">
            {etapas.map((etapa) => (
              <li key={etapa} className="flex flex-col gap-2">
                <div className="flex justify-between text-sm">
                  <span>{etapa}</span>
                  <span className="font-semibold">0</span>
                </div>
                <div className="h-3 rounded-md bg-elevado" />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Faturamento x gasto por dia" className="min-w-0 flex-[1_1_420px]">
          <EmptyState
            title="Ainda sem dados"
            text="O gráfico aparece quando o robô começar a vender e a conta de anúncios estiver conectada."
          />
        </Card>
      </div>

      <Card title="Lucro por anúncio">
        <EmptyState
          title="Nenhum anúncio rastreado"
          text="Crie um link de rastreio em Anúncios e use no seu anúncio para ver o lucro de cada um aqui."
        />
      </Card>
    </>
  );
}
