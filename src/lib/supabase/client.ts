import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./config";

/**
 * Cliente do Supabase para usar em componentes do navegador ("use client").
 */
export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no .env");
  }
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
