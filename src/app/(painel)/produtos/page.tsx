import type { Metadata } from "next";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Produtos e Pix" };

export default function ProdutosPage() {
  return (
    <>
      <PageHeader
        title="Produtos e pagamento"
        subtitle="O que você vende, como recebe e como entrega"
        actions={<Button disabled>+ Novo produto</Button>}
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-base font-semibold">Gateway de Pix</h2>
            <p className="text-sm text-suave">Gera o Pix na conversa e avisa o robô quando o pagamento cai</p>
          </div>
          <Badge tone="warn">● Não conectado</Badge>
        </div>
      </Card>

      <Card title="Produtos">
        <EmptyState
          title="Nenhum produto cadastrado"
          text="Cadastre o produto com preço, desconto máximo, forma de entrega e upsell. Entra na Fase 4."
        />
      </Card>
    </>
  );
}
