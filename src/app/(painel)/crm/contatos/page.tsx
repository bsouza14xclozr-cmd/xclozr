import type { Metadata } from "next";
import { ContatosCliente } from "../CrmPaginas";

export const metadata: Metadata = { title: "CRM · Contatos" };

export default function ContatosPage() {
  return <ContatosCliente />;
}
