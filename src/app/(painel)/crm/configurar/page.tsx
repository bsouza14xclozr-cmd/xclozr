import type { Metadata } from "next";
import { ConfigCrmCliente } from "../CrmPaginas";

export const metadata: Metadata = { title: "CRM · Configurar" };

export default function ConfigurarCrmPage() {
  return <ConfigCrmCliente />;
}
