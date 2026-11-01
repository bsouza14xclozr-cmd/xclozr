import type { Metadata } from "next";
import { KanbanCliente } from "./CrmPaginas";

export const metadata: Metadata = { title: "CRM · Kanban" };

export default function CrmPage() {
  return <KanbanCliente />;
}
