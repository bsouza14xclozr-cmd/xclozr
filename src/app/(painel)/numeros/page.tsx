import type { Metadata } from "next";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Números" };

export default function NumerosPage() {
  return (
    <>
      <PageHeader
        title="Números de WhatsApp"
        subtitle="Conecte pelo QR code e controle o rodízio entre os chips"
        actions={
          <Button disabled title="Disponível quando a Evolution API estiver ligada">
            + Conectar número
          </Button>
        }
      />

      <Card title="Seus números">
        <EmptyState
          title="Nenhum número conectado"
          text="Quando a Evolution API estiver ligada na VPS, o botão “Conectar número” vai mostrar o QR code aqui para você escanear com o WhatsApp."
        />
      </Card>

      <Card title="Rodízio e proteção contra ban">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4 text-sm">
          <div className="flex flex-col gap-2 rounded-xl bg-elevado p-4">
            <span className="text-[13px] text-suave">Link do anúncio</span>
            <span className="font-semibold">Distribui entre os chips conectados</span>
          </div>
          <div className="flex flex-col gap-2 rounded-xl bg-elevado p-4">
            <span className="text-[13px] text-suave">Chip caiu</span>
            <span className="font-semibold">Sai do rodízio na hora e você é avisado</span>
          </div>
          <div className="flex flex-col gap-2 rounded-xl bg-elevado p-4">
            <span className="text-[13px] text-suave">Atraso entre mensagens</span>
            <span className="font-semibold">Intervalo + “digitando…”</span>
          </div>
        </div>
      </Card>
    </>
  );
}
