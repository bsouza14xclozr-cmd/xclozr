import type { Metadata } from "next";
import { NotificacoesCliente } from "./NotificacoesCliente";

export const metadata: Metadata = { title: "App e notificações" };

export default function NotificacoesPage() {
  return <NotificacoesCliente />;
}
