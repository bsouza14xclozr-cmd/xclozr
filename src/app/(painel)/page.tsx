import type { Metadata } from "next";
import { VisaoGeralCliente } from "./VisaoGeralCliente";

export const metadata: Metadata = { title: "Visão geral" };

export default function VisaoGeralPage() {
  return <VisaoGeralCliente />;
}
