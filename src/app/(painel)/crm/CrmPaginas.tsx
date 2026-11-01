"use client";

import { ConfigCrmView } from "@/components/crm/ConfigCrmView";
import { ContatosView } from "@/components/crm/ContatosView";
import { KanbanView } from "@/components/crm/KanbanView";
import { useCrm } from "@/lib/crm/useCrm";

export function KanbanCliente() {
  return <KanbanView crm={useCrm()} />;
}

export function ContatosCliente() {
  return <ContatosView crm={useCrm()} />;
}

export function ConfigCrmCliente() {
  return <ConfigCrmView crm={useCrm()} />;
}
