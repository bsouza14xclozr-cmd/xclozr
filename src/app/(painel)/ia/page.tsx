import type { Metadata } from "next";
import { IaCliente } from "./IaCliente";

export const metadata: Metadata = { title: "Agente de IA" };

export default function IaPage() {
  return <IaCliente />;
}
