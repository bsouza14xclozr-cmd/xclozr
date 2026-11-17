// Gateways de Pix reais — PagBank (API de Pedidos) e LivePix (link de pagamento). As credenciais nunca saem do servidor.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ConfigGateway = {
  gateway: "pagbank" | "livepix";
  token: string; // PagBank: token | LivePix: "client_id:client_secret"
  ambiente: "producao" | "sandbox";
  segredo_webhook: string;
  acesso_token?: string | null;
  acesso_expira?: string | null;
};

const BASE = { producao: "https://api.pagseguro.com", sandbox: "https://sandbox.api.pagseguro.com" };

export async function configGateway(db: SupabaseClient, donoId: string): Promise<ConfigGateway | null> {
  const { data } = await db.from("gateway_config").select("gateway, token, ambiente, segredo_webhook, acesso_token, acesso_expira").eq("dono_id", donoId).maybeSingle();
  return (data as ConfigGateway) ?? null;
}

function urlAviso(donoId: string, segredo: string) {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/motor/pagbank?d=${donoId}&s=${segredo}`;
}

type RespostaPedido = {
  id?: string;
  reference_id?: string;
  qr_codes?: { id: string; text: string; links?: { rel: string; href: string }[] }[];
  charges?: { status?: string; paid_at?: string }[];
  error_messages?: { code?: string; description?: string; parameter_name?: string }[];
};

async function chamar(cfg: ConfigGateway, metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<RespostaPedido> {
  const r = await fetch(`${BASE[cfg.ambiente]}${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json", accept: "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await r.text();
  let j: RespostaPedido = {};
  try {
    j = JSON.parse(texto);
  } catch {
    /* corpo vazio ou html */
  }
  if (!r.ok) {
    const msg = (j.error_messages?.map((e) => [e.code, e.parameter_name, e.description].filter(Boolean).join(": ")).join("; ") || texto.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 220);
    let explicacao = msg || "sem detalhes";
    if (r.status === 401) explicacao = `token inválido para o ambiente ${cfg.ambiente === "sandbox" ? "Sandbox" : "Produção"} (${msg || "UNAUTHORIZED"})`;
    else if (r.status === 403 && /whitelist|allowlist|access_denied|não autorizad/i.test(msg)) explicacao = `sua conta ainda não está liberada para gerar Pix pela API (${msg})`;
    const erro = new Error(`PagBank recusou (${r.status}): ${explicacao}`);
    (erro as Error & { parametros?: string }).parametros = (j.error_messages ?? []).map((e) => e.parameter_name ?? "").join(",");
    throw erro;
  }
  return j;
}

/** "5524981837056" → { country, area, number } */
function telefoneBR(tel: string) {
  const d = (tel ?? "").replace(/\D/g, "");
  const m = d.match(/^55(\d{2})(\d{8,9})$/);
  return m ? [{ country: "55", area: m[1], number: m[2], type: "MOBILE" }] : undefined;
}

/** Cria o pedido com QR Code Pix. Devolve o copia-e-cola e o id do pedido. */
export async function criarPixPagBank(
  cfg: ConfigGateway,
  donoId: string,
  p: { referencia: string; descricao: string; valorCentavos: number; expiraMin: number; nome?: string | null; telefone?: string },
) {
  const expira = new Date(Date.now() + Math.max(5, Math.min(p.expiraMin, 60 * 24 * 7)) * 60_000);
  const base = {
    reference_id: p.referencia,
    items: [{ reference_id: p.referencia.slice(0, 64), name: (p.descricao || "Produto").slice(0, 64), quantity: 1, unit_amount: p.valorCentavos }],
    qr_codes: [{ amount: { value: p.valorCentavos }, expiration_date: expira.toISOString().replace(/\.\d{3}Z$/, "Z") }],
    notification_urls: [urlAviso(donoId, cfg.segredo_webhook)],
  };
  const cliente = { name: (p.nome || "Cliente").replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 60) || "Cliente", phones: p.telefone ? telefoneBR(p.telefone) : undefined };
  let r: RespostaPedido;
  try {
    r = await chamar(cfg, "POST", "/orders", { ...base, customer: cliente });
  } catch (e) {
    // alguns cadastros recusam dados parciais do cliente: tenta sem o objeto customer
    if (!/customer/i.test(`${(e as Error).message} ${(e as { parametros?: string }).parametros ?? ""}`)) throw e;
    r = await chamar(cfg, "POST", "/orders", base);
  }
  const qr = r.qr_codes?.[0];
  if (!qr?.text || !r.id) throw new Error("o PagBank não devolveu o código Pix (confira se sua conta tem uma chave Pix cadastrada)");
  return { pedidoId: r.id, copiaCola: qr.text, qrPng: qr.links?.find((l) => l.rel === "QRCODE.PNG")?.href ?? null };
}

/** Consulta o pedido direto no PagBank (nunca confia só no aviso recebido). */
export async function pedidoPago(cfg: ConfigGateway, pedidoId: string) {
  const r = await chamar(cfg, "GET", `/orders/${encodeURIComponent(pedidoId)}`);
  return { pago: (r.charges ?? []).some((c) => c.status === "PAID"), referencia: r.reference_id ?? null };
}

/* ------------------------------------------------------------------ */
/* LivePix: OAuth (client_credentials) + link de pagamento             */
/* ------------------------------------------------------------------ */
const LP_API = "https://api.livepix.gg";
const LP_TOKEN = "https://oauth.livepix.gg/oauth2/token";
const LP_ESCOPOS = ["payments:read payments:write webhooks", "payments:read payments:write", ""];

function credenciaisLivePix(cfg: ConfigGateway) {
  const i = cfg.token.indexOf(":");
  return { id: cfg.token.slice(0, i), segredo: cfg.token.slice(i + 1) };
}

function erroLivePix(status: number, texto: string) {
  let j: { message?: string; error?: string; error_description?: string; errors?: unknown } = {};
  try {
    j = JSON.parse(texto);
  } catch {
    /* html ou vazio */
  }
  const msg = (j.error_description || j.message || j.error || texto.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "sem detalhes").slice(0, 220);
  if (status === 401 || /invalid_client/i.test(msg)) return new Error(`LivePix recusou (${status}): Client ID ou Client Secret errado (${msg})`);
  if (status === 403) return new Error(`LivePix recusou (403): a aplicação não tem permissão para pagamentos — marque as permissões de pagamentos e webhooks na aplicação (${msg})`);
  if (status === 429) return new Error("LivePix pediu para esperar (muitas chamadas seguidas). Tente de novo em 1 minuto.");
  return new Error(`LivePix recusou (${status}): ${msg}`);
}

/** Token de acesso reaproveitado até perto de expirar (a LivePix monitora emissão excessiva). */
async function tokenLivePix(db: SupabaseClient, donoId: string, cfg: ConfigGateway, renovar = false): Promise<string> {
  if (!renovar && cfg.acesso_token && cfg.acesso_expira && new Date(cfg.acesso_expira).getTime() > Date.now() + 120_000) return cfg.acesso_token;
  const { id, segredo } = credenciaisLivePix(cfg);
  let ultimo: Error | null = null;
  for (const escopo of LP_ESCOPOS) {
    const corpo = new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: segredo });
    if (escopo) corpo.set("scope", escopo);
    const r = await fetch(LP_TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: corpo, signal: AbortSignal.timeout(20_000) });
    const texto = await r.text();
    if (r.ok) {
      const j = JSON.parse(texto) as { access_token: string; expires_in?: number };
      cfg.acesso_token = j.access_token;
      cfg.acesso_expira = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
      await db.from("gateway_config").update({ acesso_token: cfg.acesso_token, acesso_expira: cfg.acesso_expira }).eq("dono_id", donoId).eq("gateway", "livepix");
      return j.access_token;
    }
    ultimo = erroLivePix(r.status, texto);
    if (!/scope/i.test(texto)) break; // só tenta outro conjunto de permissões se o problema for o escopo
  }
  throw ultimo ?? new Error("LivePix não devolveu o token");
}

async function livePix<T>(db: SupabaseClient, donoId: string, cfg: ConfigGateway, metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: unknown): Promise<T> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const token = await tokenLivePix(db, donoId, cfg, tentativa > 0);
    const r = await fetch(`${LP_API}${caminho}`, {
      method: metodo,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const texto = await r.text();
    if (r.status === 401 && tentativa === 0) continue; // token vencido: renova uma vez
    if (!r.ok) throw erroLivePix(r.status, texto);
    return (texto ? JSON.parse(texto) : {}) as T;
  }
  throw new Error("LivePix recusou o token");
}

function urlRetornoLivePix(donoId: string, segredo: string, pagamentoId: string) {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/motor/livepix-volta?d=${donoId}&s=${segredo}&p=${pagamentoId}`;
}
export function urlAvisoLivePix(donoId: string, segredo: string) {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/motor/livepix?d=${donoId}&s=${segredo}`;
}

/** Cria a cobrança na LivePix. Devolve a referência e o link da página de pagamento (com Pix copia e cola e QR Code). */
export async function criarCobrancaLivePix(db: SupabaseClient, cfg: ConfigGateway, donoId: string, p: { pagamentoId: string; valorCentavos: number }) {
  const r = await livePix<{ data?: { reference?: string; redirectUrl?: string } }>(db, donoId, cfg, "POST", "/v2/payments", {
    amount: p.valorCentavos,
    currency: "BRL",
    redirectUrl: urlRetornoLivePix(donoId, cfg.segredo_webhook, p.pagamentoId),
  });
  const ref = r.data?.reference;
  const link = r.data?.redirectUrl;
  if (!ref || !link) throw new Error("a LivePix não devolveu o link de pagamento");
  return { referencia: ref, link };
}

type PagamentoLivePix = { id?: string; reference?: string; amount?: number; currency?: string; proof?: string };

/** Confere direto na API se a cobrança foi paga (nunca confia só no aviso recebido). */
export async function cobrancaLivePixPaga(db: SupabaseClient, cfg: ConfigGateway, donoId: string, referencia: string, valorCentavos: number) {
  const r = await livePix<{ data?: PagamentoLivePix[] | PagamentoLivePix }>(db, donoId, cfg, "GET", `/v2/payments?reference=${encodeURIComponent(referencia)}&limit=10`);
  const lista = Array.isArray(r.data) ? r.data : r.data ? [r.data] : [];
  return lista.some((x) => x.reference === referencia && (x.currency ?? "BRL") === "BRL" && Number(x.amount ?? 0) >= valorCentavos);
}

/** Busca um pagamento pelo id que veio no aviso e devolve a referência. */
export async function pagamentoLivePix(db: SupabaseClient, cfg: ConfigGateway, donoId: string, id: string) {
  const r = await livePix<{ data?: PagamentoLivePix }>(db, donoId, cfg, "GET", `/v2/payments/${encodeURIComponent(id)}`);
  return r.data ?? null;
}

/** Garante que a LivePix avisa o robô quando um pagamento cai. */
async function registrarAvisoLivePix(db: SupabaseClient, cfg: ConfigGateway, donoId: string) {
  const url = urlAvisoLivePix(donoId, cfg.segredo_webhook);
  const lista = await livePix<{ data?: { id: string; url: string }[] }>(db, donoId, cfg, "GET", "/v2/webhooks");
  if ((lista.data ?? []).some((w) => w.url === url)) return;
  // remove avisos antigos do XClozr (segredo trocado) e cadastra o novo
  for (const w of lista.data ?? []) if (w.url.includes("/functions/v1/motor/livepix")) await livePix(db, donoId, cfg, "DELETE", `/v2/webhooks/${w.id}`).catch(() => null);
  await livePix(db, donoId, cfg, "POST", "/v2/webhooks", { url });
}

/* ------------------------------------------------------------------ */
/* Rotas do painel: status, conectar (testa gerando uma cobrança), remover */
/* ------------------------------------------------------------------ */
export async function rotaGateway(db: SupabaseClient, donoId: string, corpo: Record<string, unknown>) {
  const acao = String(corpo.acao ?? "status");
  if (acao === "status") {
    const { data } = await db.from("gateway_config").select("gateway, ambiente, ok, erro, atualizado_em").eq("dono_id", donoId).maybeSingle();
    return { conectado: Boolean(data), ...(data ?? {}) };
  }
  if (acao === "remover") {
    await db.from("gateway_config").delete().eq("dono_id", donoId);
    return { ok: true };
  }
  if (acao === "conectar") {
    const qual = corpo.gateway === "livepix" ? "livepix" : "pagbank";
    const { data: atual } = await db.from("gateway_config").select("segredo_webhook").eq("dono_id", donoId).maybeSingle();
    const segredo = atual?.segredo_webhook ?? crypto.randomUUID().replaceAll("-", "");
    let cfg: ConfigGateway;
    if (qual === "livepix") {
      const id = String(corpo.client_id ?? "").trim();
      const sec = String(corpo.client_secret ?? "").trim();
      if (id.length < 8 || sec.length < 8) return { erro: "Cole o Client ID e o Client Secret da aplicação LivePix." };
      cfg = { gateway: "livepix", token: `${id}:${sec}`, ambiente: "producao", segredo_webhook: segredo };
      try {
        // teste de verdade: cria um link de R$ 1,00 (ninguém precisa pagar) e cadastra o aviso de pagamento
        await criarCobrancaLivePix(db, cfg, donoId, { pagamentoId: "teste", valorCentavos: 100 });
        await registrarAvisoLivePix(db, cfg, donoId);
      } catch (e) {
        return { erro: `Não funcionou: ${(e as Error).message}` };
      }
    } else {
      const token = String(corpo.token ?? "").trim();
      const ambiente = corpo.ambiente === "sandbox" ? "sandbox" : "producao";
      if (token.length < 20) return { erro: "Cole o token do PagBank." };
      cfg = { gateway: "pagbank", token, ambiente, segredo_webhook: segredo };
      try {
        // teste de verdade: gera um Pix de R$ 1,00 que expira sozinho (ninguém precisa pagar)
        await criarPixPagBank(cfg, donoId, { referencia: `teste-${Date.now()}`, descricao: "Teste de conexão XClozr", valorCentavos: 100, expiraMin: 5 });
      } catch (e) {
        return { erro: `Não funcionou: ${(e as Error).message}` };
      }
    }
    const { error } = await db.from("gateway_config").upsert({
      dono_id: donoId,
      gateway: cfg.gateway,
      token: cfg.token,
      ambiente: cfg.ambiente,
      segredo_webhook: segredo,
      acesso_token: cfg.acesso_token ?? null,
      acesso_expira: cfg.acesso_expira ?? null,
      ok: true,
      erro: null,
      atualizado_em: new Date().toISOString(),
    });
    if (error) return { erro: "Funcionou, mas não consegui salvar. Tente de novo." };
    await db.from("configuracoes").upsert({ dono_id: donoId, gateway: cfg.gateway });
    return { ok: true };
  }
  return { erro: "ação desconhecida" };
}
