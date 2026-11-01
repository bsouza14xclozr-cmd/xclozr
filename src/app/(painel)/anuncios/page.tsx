import type { Metadata } from "next";
import { AnunciosCliente } from "@/modulos/trafego/AnunciosCliente";

export const metadata: Metadata = { title: "Anúncios" };

export default function AnunciosPage() {
  return <AnunciosCliente />;
}
