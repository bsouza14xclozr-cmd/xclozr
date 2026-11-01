import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { ListaFunis } from "./ListaFunis";

export const metadata: Metadata = { title: "Funis" };

export default function FunilPage() {
  return (
    <>
      <PageHeader
        title="Funis de venda"
        subtitle="Monte o caminho da conversa: mensagens, perguntas, objeções, Pix, entrega e upsell"
      />
      <ListaFunis />
    </>
  );
}
