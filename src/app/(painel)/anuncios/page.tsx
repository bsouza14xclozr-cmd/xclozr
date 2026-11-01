import type { Metadata } from "next";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Anúncios" };

export default function AnunciosPage() {
  return (
    <>
      <PageHeader
        title="Anúncios"
        subtitle="Cada anúncio com seu link de rastreio, resultado e regras automáticas"
        actions={<Badge>● Meta Ads não conectado</Badge>}
      />

      <Card title="Todos os anúncios">
        <EmptyState
          title="Nenhum anúncio ainda"
          text="Aqui vão aparecer gasto, vendas, CPA, ROAS e lucro de cada anúncio. Entra na Fase 5."
        />
      </Card>

      <Card title="Regras automáticas">
        <p className="text-sm text-suave">
          Pausar anúncio com CPA alto, escalar os com ROAS bom e limites de proteção. Entra na Fase 6, começando no
          modo “sugerir e eu aprovo”.
        </p>
      </Card>
    </>
  );
}
