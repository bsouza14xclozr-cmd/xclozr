import type { MetadataRoute } from "next";

/** App instalável (PWA): ícone na tela inicial e notificações de vendas e alertas. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "XClozr — Vendas & Anúncios",
    short_name: "XClozr",
    description: "Robô de vendas no WhatsApp, CRM e anúncios",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0c0e12",
    theme_color: "#0c0e12",
    lang: "pt-BR",
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
