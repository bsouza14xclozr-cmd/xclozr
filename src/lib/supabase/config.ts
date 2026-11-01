export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** true quando as chaves do Supabase foram configuradas (.env.local ou Vercel) */
export const supabaseConfigurado = Boolean(supabaseUrl && supabaseAnonKey);
