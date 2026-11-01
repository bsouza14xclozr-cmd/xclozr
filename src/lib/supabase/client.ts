import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente do Supabase para usar em componentes do navegador ("use client").
 * As chaves vêm das variáveis de ambiente (veja .env.example).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no .env");
  }
  return createBrowserClient(url, key);
}
