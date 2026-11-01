import type { Metadata } from "next";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Conversas" };

export default function ConversasPage() {
  return (
    <>
      <PageHeader title="Conversas" subtitle="Acompanhe o robô vendendo e assuma quando precisar" />

      <div className="flex flex-wrap items-stretch gap-4">
        <Card title="Contatos" className="min-w-0 flex-[1_1_280px]">
          <label htmlFor="busca" className="text-xs text-suave">
            Buscar
          </label>
          <input
            id="busca"
            type="search"
            placeholder="Nome ou número"
            className="min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto placeholder:text-suave"
          />
          <p className="text-sm text-suave">Nenhuma conversa ainda.</p>
        </Card>

        <Card className="min-w-0 flex-[2_1_420px]">
          <EmptyState
            title="Selecione uma conversa"
            text="As conversas aparecem aqui quando um número estiver conectado e os clientes começarem a chamar."
          />
        </Card>
      </div>
    </>
  );
}
