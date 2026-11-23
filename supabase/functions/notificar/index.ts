/// <reference lib="deno.ns" />
// XClozr — notificações no celular/computador (Web Push do app PWA).
//   GET  /notificar/chave   → chave pública VAPID (o navegador precisa para se inscrever)
//   POST /notificar/testar  → (login) manda uma notificação de teste para os aparelhos do usuário
//   POST /notificar/enviar  → (x-segredo) manda os avisos novos do sininho como notificação
//   POST /notificar/cron    → (x-segredo, pg_cron) o mesmo + resumo diário no horário escolhido
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enviarPush, gerarVapid, type ChavesVapid } from "./webpush.ts";

const db: SupabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "content-type": "application/json" } });

const TITULO: Record<string, string> = {
  venda: "Venda aprovada!",
  lead: "💬 Novo lead!",
  chip: "📵 Chip desconectado",
  humano: "🙋 Cliente chamando você",
  funil: "⚠️ Problema no funil",
  trafego: "📈 Anúncios",
  resumo: "📊 Resumo do dia",
  info: "🔔 XClozr",
};
const TIPOS_PADRAO = ["venda", "lead", "chip", "humano", "funil", "trafego", "resumo", "info"];

let cacheVapid: ChavesVapid | null = null;
async function vapid(): Promise<ChavesVapid> {
  if (cacheVapid) return cacheVapid;
  const { data } = await db.from("motor_config").select("chave, valor").in("chave", ["vapid_publica", "vapid_privada"]);
  const m = Object.fromEntries((data ?? []).map((r) => [r.chave, r.valor]));
  if (m.vapid_publica && m.vapid_privada) return (cacheVapid = { publica: m.vapid_publica, privadaJwk: JSON.parse(m.vapid_privada) });
  // primeira vez: gera e guarda só no servidor (a privada nunca sai daqui)
  const novas = await gerarVapid();
  const { error } = await db.from("motor_config").insert([
    { chave: "vapid_publica", valor: novas.publica },
    { chave: "vapid_privada", valor: JSON.stringify(novas.privadaJwk) },
  ]);
  if (error) {
    // outra execução gerou ao mesmo tempo: usa a que ficou salva
    const { data: d2 } = await db.from("motor_config").select("chave, valor").in("chave", ["vapid_publica", "vapid_privada"]);
    const m2 = Object.fromEntries((d2 ?? []).map((r) => [r.chave, r.valor]));
    return (cacheVapid = { publica: m2.vapid_publica, privadaJwk: JSON.parse(m2.vapid_privada) });
  }
  return (cacheVapid = novas);
}

async function segredoOk(req: Request) {
  const { data } = await db.from("motor_config").select("valor").eq("chave", "segredo_relogio").maybeSingle();
  return Boolean(data?.valor) && req.headers.get("x-segredo") === data!.valor;
}

type Prefs = { dono_id: string; ativo: boolean; tipos: string[]; resumo_hora: number; resumo_ultimo: string | null };
async function prefsDe(donos: string[]) {
  const { data } = await db.from("notif_prefs").select("dono_id, ativo, tipos, resumo_hora, resumo_ultimo").in("dono_id", donos);
  return new Map(((data ?? []) as Prefs[]).map((p) => [p.dono_id, p]));
}

/** Manda uma notificação para todos os aparelhos do dono. Apaga inscrições mortas. */
async function paraDono(donoId: string, dados: { titulo: string; corpo: string; link?: string | null; tag?: string }) {
  const { data: inscs } = await db.from("push_inscricoes").select("id, endpoint, p256dh, auth").eq("dono_id", donoId);
  if (!inscs?.length) return 0;
  const chaves = await vapid();
  let ok = 0;
  await Promise.all(
    inscs.map(async (i) => {
      try {
        const st = await enviarPush(i, { titulo: dados.titulo, corpo: dados.corpo, link: dados.link ?? "/", tag: dados.tag }, chaves);
        if (st === 404 || st === 410) await db.from("push_inscricoes").delete().eq("id", i.id);
        else if (st >= 200 && st < 300) {
          ok++;
          await db.from("push_inscricoes").update({ ultimo_envio: new Date().toISOString(), erro: null }).eq("id", i.id);
        } else await db.from("push_inscricoes").update({ erro: `HTTP ${st}` }).eq("id", i.id);
      } catch (e) {
        await db.from("push_inscricoes").update({ erro: String((e as Error).message).slice(0, 200) }).eq("id", i.id);
      }
    }),
  );
  return ok;
}

/** Avisos novos do sininho → notificação (cada aviso vai uma vez só). */
async function enviarPendentes() {
  const desde = new Date(Date.now() - 2 * 3600_000).toISOString(); // aviso velho não vira notificação
  const { data: avisos } = await db
    .from("avisos")
    .select("id, dono_id, tipo, texto, link, push_titulo, push_corpo")
    .is("push_em", null)
    .gte("criado_em", desde)
    .order("criado_em")
    .limit(100);
  if (!avisos?.length) return 0;
  // marca antes de enviar (evita mandar duas vezes se o cron cruzar)
  const { data: pegos } = await db.from("avisos").update({ push_em: new Date().toISOString() }).in("id", avisos.map((a) => a.id)).is("push_em", null).select("id");
  const ids = new Set((pegos ?? []).map((p) => p.id));
  const prefs = await prefsDe([...new Set(avisos.map((a) => a.dono_id))]);
  let enviados = 0;
  for (const a of avisos) {
    if (!ids.has(a.id)) continue;
    const p = prefs.get(a.dono_id);
    if (p && (!p.ativo || !(p.tipos ?? TIPOS_PADRAO).includes(a.tipo))) continue;
    enviados += await paraDono(a.dono_id, {
      titulo: a.push_titulo || TITULO[a.tipo] || TITULO.info,
      corpo: a.push_corpo || a.texto,
      link: a.link,
      tag: a.tipo === "chip" ? "chip" : a.id,
    });
  }
  return enviados;
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Resumo do dia no horário escolhido (vira aviso no sininho e notificação). */
async function resumosDiarios() {
  const agoraBR = new Date(Date.now() - 3 * 3600_000);
  const hoje = agoraBR.toISOString().slice(0, 10);
  const hora = agoraBR.getUTCHours();
  const { data: lista } = await db.from("notif_prefs").select("dono_id, ativo, tipos, resumo_hora, resumo_ultimo").eq("ativo", true).eq("resumo_hora", hora);
  let feitos = 0;
  for (const p of (lista ?? []) as Prefs[]) {
    if (p.resumo_ultimo === hoje || !(p.tipos ?? TIPOS_PADRAO).includes("resumo")) continue;
    await db.from("notif_prefs").update({ resumo_ultimo: hoje }).eq("dono_id", p.dono_id);
    const inicio = new Date(`${hoje}T03:00:00Z`).toISOString(); // 00:00 em Brasília
    const [{ data: pags }, { data: gastos }, { count: leads }] = await Promise.all([
      db.from("pagamentos").select("valor_centavos, taxa_centavos, tipo").eq("dono_id", p.dono_id).eq("status", "pago").eq("simulacao", false).gte("pago_em", inicio),
      db.from("meta_insights_dia").select("anuncio_id, gasto_centavos").eq("dono_id", p.dono_id).eq("dia", hoje),
      db.from("contatos").select("id", { count: "exact", head: true }).eq("dono_id", p.dono_id).eq("simulacao", false).gte("criado_em", inicio),
    ]);
    const vendas = (pags ?? []).filter((x) => x.tipo !== "upsell").length;
    const fat = (pags ?? []).reduce((t, x) => t + x.valor_centavos, 0);
    const taxas = (pags ?? []).reduce((t, x) => t + (x.taxa_centavos ?? 0), 0);
    const gasto = (gastos ?? []).reduce((t, x) => t + Number(x.gasto_centavos), 0);
    const lucro = fat - taxas - gasto;
    const partes = [
      `${leads ?? 0} conversa${leads === 1 ? "" : "s"} nova${leads === 1 ? "" : "s"}`,
      `${vendas} venda${vendas === 1 ? "" : "s"} (${brl(fat)})`,
      gasto ? `gasto em anúncios ${brl(gasto)}` : null,
      `lucro ${brl(lucro)}`,
      gasto && vendas ? `custo por venda ${brl(Math.round(gasto / vendas))}` : null,
    ].filter(Boolean);
    await db.from("avisos").insert({ dono_id: p.dono_id, tipo: "resumo", texto: `Hoje: ${partes.join(" · ")}.`, link: "/" });
    feitos++;
  }
  return feitos;
}

async function testar(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = jwt ? await db.auth.getUser(jwt) : { data: null };
  const donoId = u?.user?.id;
  if (!donoId) return json({ erro: "não autenticado" }, 401);
  const n = await paraDono(donoId, { titulo: "🔔 Teste do XClozr", corpo: "Prontinho! É assim que as vendas e os alertas vão chegar aqui.", link: "/", tag: "teste" });
  if (!n) return json({ erro: "Nenhum aparelho recebeu. Ative as notificações neste aparelho e tente de novo." }, 400);
  return json({ ok: true, aparelhos: n });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const rota = new URL(req.url).pathname.replace(/^.*\/notificar/, "") || "/";
  try {
    if (rota === "/chave") return json({ chave: (await vapid()).publica });
    if (rota === "/testar" && req.method === "POST") return await testar(req);
    if ((rota === "/enviar" || rota === "/cron") && req.method === "POST") {
      if (!(await segredoOk(req))) return json({ erro: "segredo inválido" }, 401);
      const resumos = rota === "/cron" ? await resumosDiarios() : 0;
      const enviados = await enviarPendentes();
      return json({ ok: true, enviados, resumos });
    }
    return json({ erro: "rota não encontrada" }, 404);
  } catch (e) {
    console.error(e);
    return json({ erro: "falha interna" }, 500);
  }
});
