/// <reference lib="deno.ns" />
// XClozr — módulo de pagamentos: conexão do gateway pelo painel (o token só entra; nunca volta para o navegador)
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { rotaGateway } from "./gateway.ts";

const db: SupabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data } = jwt ? await db.auth.getUser(jwt) : { data: null };
    const donoId = data?.user?.id;
    if (!donoId) return json({ erro: "não autenticado" }, 401);
    const r = await rotaGateway(db, donoId, await req.json().catch(() => ({})));
    return json(r, "erro" in r && r.erro ? 400 : 200);
  } catch (e) {
    console.error(e);
    return json({ erro: "falha interna" }, 500);
  }
});
