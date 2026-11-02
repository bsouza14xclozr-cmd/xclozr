/// <reference lib="deno.ns" />
// XClozr — módulo API de Conversões do Meta (devolve Lead, Pix gerado e Compra ao Pixel/dataset).
//   POST /conversoes/painel → painel (login): status, salvar, testar, remover
//   POST /conversoes/cron   → pg_cron a cada minuto (header x-segredo): envia a fila
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v25.0";
const db: SupabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "content-type": "application/json" } });

type Config = { dono_id: string; pixel_id: string; token: string; test_code: string | null };

async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Dados do cliente para o Meta reconhecer a pessoa (sempre com hash, como o Meta exige). */
async function dadosCliente(contato: { id: string; telefone: string; nome: string | null } | null) {
  const u: Record<string, unknown> = { country: [await sha256("br")] };
  if (!contato) return u;
  u.external_id = [await sha256(contato.id)];
  const tel = (contato.telefone ?? "").replace(/\D/g, "");
  if (tel.length >= 10) u.ph = [await sha256(tel.startsWith("55") ? tel : `55${tel}`)];
  const partes = (contato.nome ?? "").normalize("NFC").toLowerCase().replace(/[^\p{L}\s'-]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (partes[0]) u.fn = [await sha256(partes[0])];
  if (partes.length > 1) u.ln = [await sha256(partes[partes.length - 1])];
  return u;
}

async function enviar(cfg: Config, eventos: unknown[]) {
  const corpo: Record<string, unknown> = { data: eventos };
  if (cfg.test_code) corpo.test_event_code = cfg.test_code;
  const r = await fetch(`${GRAPH}/${encodeURIComponent(cfg.pixel_id)}/events?access_token=${encodeURIComponent(cfg.token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw new Error(j?.error?.error_user_msg ?? j?.error?.message ?? `Meta respondeu ${r.status}`);
  return j as { events_received?: number; fbtrace_id?: string };
}

/* ------------------------------------------------------------------ */
/* Painel                                                              */
/* ------------------------------------------------------------------ */
async function painel(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = jwt ? await db.auth.getUser(jwt) : { data: null };
  const donoId = u?.user?.id;
  if (!donoId) return json({ erro: "não autenticado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const acao = String(corpo.acao ?? "");

  if (acao === "salvar") {
    const pixel = String(corpo.pixel_id ?? "").replace(/\D/g, "");
    const token = String(corpo.token ?? "").trim();
    const { data: atual } = await db.from("capi_config").select("token").eq("dono_id", donoId).maybeSingle();
    const tk = token || atual?.token || "";
    if (pixel.length < 10) return json({ erro: "Cole o ID do Pixel (só números)." }, 400);
    if (tk.length < 30) return json({ erro: "Cole o token da API de Conversões." }, 400);
    const r = await fetch(`${GRAPH}/${pixel}?fields=id,name&access_token=${encodeURIComponent(tk)}`, { signal: AbortSignal.timeout(15_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.error) return json({ erro: `O Meta recusou: ${j?.error?.message ?? r.status}. Confira se o token foi gerado nesse mesmo Pixel.` }, 400);
    const { error } = await db.from("capi_config").upsert({
      dono_id: donoId,
      pixel_id: pixel,
      pixel_nome: j.name ?? null,
      token: tk,
      test_code: String(corpo.test_code ?? "").trim() || null,
      ativo: true,
      erro: null,
      atualizado_em: new Date().toISOString(),
    });
    if (error) return json({ erro: "Não consegui salvar." }, 500);
    return json({ ok: true, pixel_nome: j.name ?? null });
  }

  const { data: cfg } = await db.from("capi_config").select("dono_id, pixel_id, token, test_code").eq("dono_id", donoId).maybeSingle();
  if (!cfg) return json({ erro: "Conecte o Pixel primeiro." }, 400);

  if (acao === "testar") {
    if (!cfg.test_code) return json({ erro: "Coloque o código de teste (aba Testar eventos do Gerenciador de Eventos) para enviar um evento de teste." }, 400);
    try {
      const r = await enviar(cfg as Config, [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: `teste-${crypto.randomUUID()}`,
          action_source: "chat",
          user_data: await dadosCliente({ id: "teste-xclozr", telefone: "5511999999999", nome: "Teste XClozr" }),
          custom_data: { currency: "BRL", value: 1, content_name: "Teste XClozr" },
        },
      ]);
      return json({ ok: true, recebidos: r.events_received ?? 0 });
    } catch (e) {
      return json({ erro: `O Meta recusou: ${(e as Error).message}` }, 400);
    }
  }

  if (acao === "remover") {
    await db.from("capi_config").delete().eq("dono_id", donoId);
    return json({ ok: true });
  }
  return json({ erro: "ação desconhecida" }, 400);
}

/* ------------------------------------------------------------------ */
/* Fila (cron)                                                         */
/* ------------------------------------------------------------------ */
async function cron(req: Request) {
  const { data: seg } = await db.from("motor_config").select("valor").eq("chave", "segredo_relogio").maybeSingle();
  if (!seg?.valor || req.headers.get("x-segredo") !== seg.valor) return json({ erro: "segredo inválido" }, 401);

  const { data: fila } = await db
    .from("capi_eventos")
    .select("id, dono_id, contato_id, pagamento_id, evento, event_id, valor_centavos, tentativas, criado_em")
    .eq("status", "pendente")
    .order("criado_em")
    .limit(200);
  if (!fila?.length) return json({ ok: true, enviados: 0 });

  const porDono = new Map<string, typeof fila>();
  for (const e of fila) porDono.set(e.dono_id, [...(porDono.get(e.dono_id) ?? []), e]);

  let enviados = 0;
  for (const [donoId, eventos] of porDono) {
    const { data: cfg } = await db.from("capi_config").select("dono_id, pixel_id, token, test_code, ativo").eq("dono_id", donoId).maybeSingle();
    if (!cfg || !cfg.ativo) {
      await db.from("capi_eventos").update({ status: "ignorado", resposta: "API de Conversões desligada" }).in("id", eventos.map((e) => e.id));
      continue;
    }
    // o Meta só aceita eventos dos últimos 7 dias
    const limite = Date.now() - 6.5 * 86_400_000;
    const velhos = eventos.filter((e) => new Date(e.criado_em).getTime() < limite);
    if (velhos.length) await db.from("capi_eventos").update({ status: "ignorado", resposta: "mais de 7 dias" }).in("id", velhos.map((e) => e.id));
    const validos = eventos.filter((e) => new Date(e.criado_em).getTime() >= limite);

    const contatosIds = [...new Set(validos.map((e) => e.contato_id).filter(Boolean))] as string[];
    const { data: contatos } = contatosIds.length ? await db.from("contatos").select("id, telefone, nome, meta_ad_id").in("id", contatosIds) : { data: [] };
    const pagIds = [...new Set(validos.map((e) => e.pagamento_id).filter(Boolean))] as string[];
    const { data: pags } = pagIds.length ? await db.from("pagamentos").select("id, produto_id, tipo, produto:produtos(nome)").in("id", pagIds) : { data: [] };
    const contatoDe = new Map((contatos ?? []).map((c) => [c.id, c]));
    const pagDe = new Map((pags ?? []).map((p: any) => [p.id, p]));

    for (let i = 0; i < validos.length; i += 50) {
      const lote = validos.slice(i, i + 50);
      const corpo = [];
      for (const e of lote) {
        const c = e.contato_id ? contatoDe.get(e.contato_id) ?? null : null;
        const p = e.pagamento_id ? pagDe.get(e.pagamento_id) : null;
        const prod = Array.isArray(p?.produto) ? p.produto[0] : p?.produto;
        const custom: Record<string, unknown> = { currency: "BRL" };
        if (e.valor_centavos != null) custom.value = Math.round(e.valor_centavos) / 100;
        if (p?.produto_id) {
          custom.content_ids = [p.produto_id];
          custom.content_type = "product";
          custom.contents = [{ id: p.produto_id, quantity: 1, item_price: (e.valor_centavos ?? 0) / 100 }];
        }
        if (prod?.nome) custom.content_name = prod.nome;
        if (p?.tipo === "upsell") custom.content_category = "upsell";
        corpo.push({
          event_name: e.evento,
          event_time: Math.floor(new Date(e.criado_em).getTime() / 1000),
          event_id: e.event_id,
          action_source: "chat",
          user_data: await dadosCliente(c),
          custom_data: custom,
        });
      }
      try {
        await enviar(cfg as Config, corpo);
        await db.from("capi_eventos").update({ status: "enviado", enviado_em: new Date().toISOString(), resposta: null }).in("id", lote.map((e) => e.id));
        await db.from("capi_config").update({ ultimo_envio: new Date().toISOString(), erro: null }).eq("dono_id", donoId);
        enviados += lote.length;
      } catch (err) {
        const msg = String((err as Error).message).slice(0, 300);
        for (const e of lote) {
          const t = e.tentativas + 1;
          await db.from("capi_eventos").update({ tentativas: t, status: t >= 5 ? "erro" : "pendente", resposta: msg }).eq("id", e.id);
        }
        await db.from("capi_config").update({ erro: msg }).eq("dono_id", donoId);
      }
    }
  }
  return json({ ok: true, enviados });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const rota = new URL(req.url).pathname.replace(/^.*\/conversoes/, "") || "/";
  try {
    if (rota === "/painel" && req.method === "POST") return await painel(req);
    if (rota === "/cron" && req.method === "POST") return await cron(req);
    return json({ erro: "rota não encontrada" }, 404);
  } catch (e) {
    console.error(e);
    return json({ erro: "falha interna" }, 500);
  }
});
