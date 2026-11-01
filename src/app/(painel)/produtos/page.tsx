import type { Metadata } from "next";
import { ProdutosCliente } from "./ProdutosCliente";

export const metadata: Metadata = { title: "Produtos e Pix" };

export default function ProdutosPage() {
  return <ProdutosCliente />;
}
