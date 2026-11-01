import type { Metadata } from "next";
import { NumerosCliente } from "./NumerosCliente";

export const metadata: Metadata = { title: "Números" };

export default function NumerosPage() {
  return <NumerosCliente />;
}
