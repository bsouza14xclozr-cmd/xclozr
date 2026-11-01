import type { Metadata } from "next";
import { DisparosCliente } from "./DisparosCliente";

export const metadata: Metadata = { title: "Disparos" };

export default function DisparosPage() {
  return <DisparosCliente />;
}
