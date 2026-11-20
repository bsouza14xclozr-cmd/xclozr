import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "XClozr",
    template: "%s · XClozr",
  },
  description: "Assistente de Vendas & Anúncios",
  appleWebApp: { capable: true, title: "XClozr", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#0c0e12" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
