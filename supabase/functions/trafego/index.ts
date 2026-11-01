/// <reference lib="deno.ns" />
// XClozr — módulo Tráfego (Meta Ads). Separado do motor para virar módulo pago no SaaS.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { agir, contasDoToken, quemSou, sincronizarDono, type Nivel } from "./meta.ts";
import { avaliarRegras, diaBR, horaBR, lerCfg } from "./regras.ts";
import { aplicarSugestao, rodarAgente } from "./agente.ts";

const db: SupabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function json(dados: unknown, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: { ...CORS, "content-type": "application/json" } });
}

async function usuario(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  return data?.user?.id ?? null;
}

async function segredoRelogio() {
  const { data } = await db.from("motor_config").select("valor").eq("chave", "segredo_relogio").maybeSingle();
  return data?.valor ?? "";
}

async function painel(req: Request) {
  const donoId = await usuario(req);
  if (!donoId) return json({ erro: "não autenticado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const acao = String(corpo.acao ?? "status");
  const { data: cfg } = await db.from("meta_config").select("token, usuario_nome, contas, ultimo_sync, erro").eq("dono_id", donoId).maybeSingle();

  if (acao === "status") {
    const { data: contas } = await db.from("meta_contas").select("id, nome, moeda, status").eq("dono_id", donoId).order("nome");
    return json({
      conectado: Boolean(cfg),
      usuario: cfg?.usuario_nome ?? null,
      escolhidas: cfg?.contas ?? [],
      contas: contas ?? [],
      ultimo_sync: cfg?.ultimo_sync ?? null,
      erro: cfg?.erro ?? null,
    });
  }

  if (acao === "conectar") {
    const token = String(corpo.token ?? "").trim();
    if (token.length < 30) return json({ erro: "Cole o token de acesso do Meta." }, 400);
    let eu, contas;
    try {
      eu = await quemSou(token);
      contas = await contasDoToken(token);
    } catch (e) {
      return json({ erro: `O Meta recusou o token: ${(e as Error).message}` }, 400);
    }
    if (!contas.length) return json({ erro: "Esse token não tem acesso a nenhuma conta de anúncio. Dê acesso às contas para o usuário do sistema." }, 400);
    await db.from("meta_contas").delete().eq("dono_id", donoId);
    await db.from("meta_contas").insert(contas.map((c) => ({ id: c.id, dono_id: donoId, nome: c.name, moeda: c.currency, status: c.account_status })));
    const ativas = contas.filter((c) => c.account_status === 1).map((c) => c.id).slice(0, 10);
    const { error } = await db.from("meta_config").upsert({
      dono_id: donoId,
      token,
      usuario_nome: eu.name,
      contas: cfg?.contas?.length ? cfg.contas.filter((x: string) => contas.some((c) => c.id === x)) : ativas,
      ultimo_sync: null,
      erro: null,
      atualizado_em: new Date().toISOString(),
    });
    if (error) return json({ erro: "Não consegui salvar a conexão." }, 500);
    const sync = await sincronizarDono(db, donoId);
    return json({ ok: true, usuario: eu.name, contas: contas.length, sync });
  }

  if (!cfg) return json({ erro: "Conecte o Meta Ads primeiro." }, 400);

  if (acao === "escolher_contas") {
    const lista = (Array.isArray(corpo.contas) ? corpo.contas : []).map(String).slice(0, 25);
    const { data: validas } = await db.from("meta_contas").select("id").eq("dono_id", donoId).in("id", lista.length ? lista : ["-"]);
    await db.from("meta_config").update({ contas: (validas ?? []).map((v) => v.id), ultimo_sync: null }).eq("dono_id", donoId);
    return json(await sincronizarDono(db, donoId));
  }

  if (acao === "sincronizar") return json(await sincronizarDono(db, donoId));

  if (acao === "desconectar") {
    await db.from("meta_config").delete().eq("dono_id", donoId);
    return json({ ok: true });
  }

  if (acao === "agente_rodar") return json(await rodarAgente(db, donoId, true));

  if (acao === "aplicar_sugestao") return json(await aplicarSugestao(db, donoId, String(corpo.id ?? "")));

  if (acao === "regras_rodar") return json(await avaliarRegras(db, donoId));

  if (acao === "agir") {
    const nivel = String(corpo.nivel) as Nivel;
    if (!["campanha", "conjunto", "anuncio"].includes(nivel)) return json({ erro: "nível inválido" }, 400);
    const tipo = String(corpo.tipo) as "pausar" | "ativar" | "orcamento";
    if (!["pausar", "ativar", "orcamento"].includes(tipo)) return json({ erro: "ação inválida" }, 400);
    try {
      return json(await agir(db, donoId, nivel, String(corpo.id ?? ""), tipo, Number(corpo.valor_centavos)));
    } catch (e) {
      return json({ erro: String((e as Error).message).slice(0, 300) }, 400);
    }
  }

  return json({ erro: "ação desconhecida" }, 400);
}

// Chamado pelo pg_cron a cada 15 min: sincroniza, roda as regras e o agente diário
async function cron(req: Request) {
  const seg = await segredoRelogio();
  if (!seg || req.headers.get("x-segredo") !== seg) return json({ erro: "segredo inválido" }, 401);
  const inicio = Date.now();
  const { data: donos } = await db.from("meta_config").select("dono_id, ultimo_sync").limit(50);
  const resumo: Record<string, unknown> = {};
  for (const d of donos ?? []) {
    if (Date.now() - inicio > 110_000) break; // não estoura o tempo da função
    try {
      const { count: regrasAtivas } = await db.from("meta_regras").select("id", { count: "exact", head: true }).eq("dono_id", d.dono_id).eq("ativa", true);
      const idade = d.ultimo_sync ? Date.now() - new Date(d.ultimo_sync).getTime() : Infinity;
      // com regras ativas os números precisam estar frescos; sem regras, de hora em hora basta
      if (idade > (regrasAtivas ? 14 : 55) * 60_000) await sincronizarDono(db, d.dono_id);
      const regras = regrasAtivas ? await avaliarRegras(db, d.dono_id) : null;
      const cfg = await lerCfg(db, d.dono_id);
      let agente: unknown = null;
      if (cfg.agente_modo !== "desligado" && horaBR() >= cfg.agente_hora && cfg.agente_ultimo !== diaBR(0)) {
        await db.from("trafego_config").upsert({ dono_id: d.dono_id, agente_ultimo: diaBR(0) }); // 1 tentativa por dia
        agente = await rodarAgente(db, d.dono_id);
      }
      resumo[d.dono_id.slice(0, 6)] = { regras, agente };
    } catch (e) {
      console.error("cron tráfego", d.dono_id, e);
    }
  }
  return json({ ok: true, resumo });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const rota = new URL(req.url).pathname.replace(/^.*\/trafego/, "") || "/";
  try {
    if (rota === "/saude") return json({ ok: true, modulo: "trafego" });
    if (rota === "/painel" && req.method === "POST") return await painel(req);
    if (rota === "/cron" && req.method === "POST") return await cron(req);
    return json({ erro: "rota não encontrada" }, 404);
  } catch (e) {
    console.error(e);
    return json({ erro: "falha interna" }, 500);
  }
});
