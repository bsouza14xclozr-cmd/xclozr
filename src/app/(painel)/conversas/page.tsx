import type { Metadata } from "next";
import { ConversasCliente } from "./ConversasCliente";

export const metadata: Metadata = { title: "Conversas" };

export default function ConversasPage() {
  return <ConversasCliente />;
}
