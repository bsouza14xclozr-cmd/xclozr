// Módulo Tráfego — integração com a Marketing API do Meta
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const GRAPH = "https://graph.facebook.com/v25.0";
const TIPO_CONVERSA = "onsite_conversion.messaging_conversation_started_7d";

type Pagina<T> = { data?: T[]; paging?: { next?: string }; error?: { message: string; code?: number } };

export class ErroMeta extends Error {
  constructor(msg: string, public codigo?: number) {
    super(msg);
  }
}

async function pedir<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw new ErroMeta(j?.error?.message ?? `Meta respondeu ${r.status}`, j?.error?.code);
  return j as T;
}

export async function listar<T>(token: string, caminho: string, params: Record<string, string>, limite = 5000): Promise<T[]> {
  const u = new URL(`${GRAPH}/${caminho}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  let url: string | undefined = u.toString();
  const tudo: T[] = [];
  while (url && tudo.length < limite) {
    const p: Pagina<T> = await pedir<Pagina<T>>(url, token);
    tudo.push(...(p.data ?? []));
    url = p.paging?.next;
  }
  return tudo;
}

export async function quemSou(token: string) {
  return await pedir<{ id: string; name: string }>(`${GRAPH}/me?fields=id,name`, token);
}

export async function contasDoToken(token: string) {
  return await listar<{ id: string; name: string; currency: string; account_status: number }>(token, "me/adaccounts", {
    fields: "id,name,currency,account_status",
    limit: "100",
  });
}

const centavos = (v: unknown) => (v === undefined || v === null || v === "" ? null : Math.round(Number(v)));
const dinheiroParaCentavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);

function diaBrasilia(offsetDias = 0) {
  const d = new Date(Date.now() - 3 * 3600_000 + offsetDias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function emLotes<T>(itens: T[], tamanho: number, fn: (lote: T[]) => PromiseLike<{ error: { message: string } | null }>) {
  for (let i = 0; i < itens.length; i += tamanho) {
    const { error } = await fn(itens.slice(i, i + tamanho));
    if (error) throw new Error(`Erro ao salvar dados do Meta: ${error.message}`);
  }
}

/** Puxa campanhas, conjuntos, anúncios e números por dia de uma conta. */
export async function sincronizarConta(db: SupabaseClient, donoId: string, token: string, conta: string, diasAtras: number) {
  const agora = new Date().toISOString();

  const camps = await listar<Record<string, any>>(token, `${conta}/campaigns`, {
    fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget",
    limit: "200",
  });
  await emLotes(camps, 200, (l) =>
    db.from("meta_campanhas").upsert(
      l.map((c) => ({
        id: c.id,
        dono_id: donoId,
        conta_id: conta,
        nome: c.name,
        status: c.status,
        status_efetivo: c.effective_status,
        objetivo: c.objective,
        orcamento_diario: centavos(c.daily_budget),
        orcamento_total: centavos(c.lifetime_budget),
        atualizado_em: agora,
      })),
    ),
  );

  const sets = await listar<Record<string, any>>(token, `${conta}/adsets`, {
    fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget",
    limit: "200",
  });
  await emLotes(sets, 200, (l) =>
    db.from("meta_conjuntos").upsert(
      l.map((s) => ({
        id: s.id,
        dono_id: donoId,
        conta_id: conta,
        campanha_id: s.campaign_id,
        nome: s.name,
        status: s.status,
        status_efetivo: s.effective_status,
        orcamento_diario: centavos(s.daily_budget),
        orcamento_total: centavos(s.lifetime_budget),
        atualizado_em: agora,
      })),
    ),
  );

  const ads = await listar<Record<string, any>>(token, `${conta}/ads`, {
    fields: "id,name,adset_id,campaign_id,status,effective_status,creative{thumbnail_url}",
    limit: "200",
  });
  await emLotes(ads, 200, (l) =>
    db.from("meta_anuncios").upsert(
      l.map((a) => ({
        id: a.id,
        dono_id: donoId,
        conta_id: conta,
        campanha_id: a.campaign_id,
        conjunto_id: a.adset_id,
        nome: a.name,
        status: a.status,
        status_efetivo: a.effective_status,
        miniatura: a.creative?.thumbnail_url ?? null,
        atualizado_em: agora,
      })),
    ),
  );

  const ins = await listar<Record<string, any>>(token, `${conta}/insights`, {
    level: "ad",
    fields: "ad_id,adset_id,campaign_id,spend,impressions,clicks,actions",
    time_increment: "1",
    time_range: JSON.stringify({ since: diaBrasilia(-diasAtras), until: diaBrasilia(0) }),
    limit: "500",
  });
  await emLotes(ins, 300, (l) =>
    db.from("meta_insights_dia").upsert(
      l.map((i) => ({
        dono_id: donoId,
        anuncio_id: i.ad_id,
        conjunto_id: i.adset_id,
        campanha_id: i.campaign_id,
        conta_id: conta,
        dia: i.date_start,
        gasto_centavos: dinheiroParaCentavos(i.spend),
        impressoes: Number(i.impressions ?? 0),
        cliques: Number(i.clicks ?? 0),
        conversas: Number((i.actions ?? []).find((a: { action_type: string }) => a.action_type === TIPO_CONVERSA)?.value ?? 0),
        atualizado_em: agora,
      })),
    ),
  );
  return { campanhas: camps.length, conjuntos: sets.length, anuncios: ads.length, linhas: ins.length };
}

export async function sincronizarDono(db: SupabaseClient, donoId: string) {
  const { data: cfg } = await db.from("meta_config").select("token, contas, ultimo_sync").eq("dono_id", donoId).maybeSingle();
  if (!cfg) return { erro: "Meta não conectado" };
  const dias = cfg.ultimo_sync ? 2 : 29; // 1ª vez puxa 30 dias; depois só os últimos 3 (o Meta ajusta números recentes)
  const res: Record<string, unknown> = {};
  try {
    for (const conta of cfg.contas ?? []) res[conta] = await sincronizarConta(db, donoId, cfg.token, conta, dias);
    await db.from("meta_config").update({ ultimo_sync: new Date().toISOString(), erro: null }).eq("dono_id", donoId);
    return { ok: true, res };
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 300);
    await db.from("meta_config").update({ ultimo_sync: new Date().toISOString(), erro: msg }).eq("dono_id", donoId);
    if (e instanceof ErroMeta && (e.codigo === 190 || /token/i.test(msg))) {
      await db.from("avisos").insert({ dono_id: donoId, tipo: "info", texto: `A conexão com o Meta Ads parou de funcionar (${msg}). Gere um novo token em Anúncios.`, link: "/anuncios" });
    }
    return { erro: msg };
  }
}

export type Nivel = "campanha" | "conjunto" | "anuncio";
const TABELA: Record<Nivel, string> = { campanha: "meta_campanhas", conjunto: "meta_conjuntos", anuncio: "meta_anuncios" };

/** Pausa, ativa ou muda o orçamento diário de uma campanha/conjunto/anúncio. */
export async function agir(
  db: SupabaseClient,
  donoId: string,
  nivel: Nivel,
  id: string,
  acao: "pausar" | "ativar" | "orcamento",
  valorCentavos?: number,
  origem: "painel" | "regra" = "painel",
  extra: { regraId?: string; motivo?: string } = {},
) {
  const { data: cfg } = await db.from("meta_config").select("token").eq("dono_id", donoId).maybeSingle();
  if (!cfg) throw new Error("Meta não conectado");
  const { data: obj } = await db.from(TABELA[nivel]).select("*").eq("id", id).eq("dono_id", donoId).maybeSingle();
  if (!obj) throw new Error("Não encontrei esse item. Atualize a lista.");

  const corpo = new URLSearchParams();
  let de = "";
  let para = "";
  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if (acao === "orcamento") {
    if (nivel === "anuncio") throw new Error("Anúncio não tem orçamento: mude no conjunto ou na campanha.");
    if (!obj.orcamento_diario) throw new Error("Esse item não usa orçamento diário aqui (está no outro nível ou é vitalício).");
    const v = Math.round(Number(valorCentavos));
    if (!Number.isFinite(v) || v < 100) throw new Error("Orçamento inválido.");
    corpo.set("daily_budget", String(v));
    de = String(obj.orcamento_diario);
    para = String(v);
    patch.orcamento_diario = v;
  } else {
    const st = acao === "pausar" ? "PAUSED" : "ACTIVE";
    corpo.set("status", st);
    de = obj.status;
    para = st;
    patch.status = st;
    patch.status_efetivo = st === "PAUSED" ? "PAUSED" : obj.status_efetivo === "PAUSED" ? "ACTIVE" : obj.status_efetivo;
  }

  try {
    await pedir(`${GRAPH}/${id}`, cfg.token, { method: "POST", body: corpo, headers: { "content-type": "application/x-www-form-urlencoded" } });
  } catch (e) {
    await db.from("meta_acoes").insert({ dono_id: donoId, objeto_id: id, nivel, nome: obj.nome, acao, de, para, origem, ok: false, erro: String((e as Error).message).slice(0, 300), regra_id: extra.regraId ?? null, motivo: extra.motivo ?? null });
    throw e;
  }
  await db.from(TABELA[nivel]).update(patch).eq("id", id);
  await db.from("meta_acoes").insert({ dono_id: donoId, objeto_id: id, nivel, nome: obj.nome, acao, de, para, origem, ok: true, regra_id: extra.regraId ?? null, motivo: extra.motivo ?? null });
  return { ok: true };
}
