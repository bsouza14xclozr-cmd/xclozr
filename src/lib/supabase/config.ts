/**
 * Configuração do Supabase.
 *
 * A URL e a chave "publishable" são PÚBLICAS por natureza (vão para o navegador de qualquer jeito);
 * quem protege os dados é o RLS no banco. Por isso ficam aqui no código, sem precisar configurar a Vercel.
 * Se um dia quiser trocar, basta definir NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
 *
 * NUNCA coloque aqui a chave secreta (service_role / sb_secret_...).
 */
export const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hwfhrjvzanmsvxxdyifh.supabase.co";

export const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_FcZgfrISTp2evOWYuzuHog_get0HMhp";

export const supabaseConfigurado = Boolean(supabaseUrl && supabaseAnonKey);
