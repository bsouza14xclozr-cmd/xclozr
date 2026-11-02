// Gateway de Pix real — PagBank (API de Pedidos). O token nunca sai do servidor.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ConfigGateway = { gateway: "pagbank"; token: string; ambiente: "producao" | "sandbox"; segredo_webhook: string };

const BASE = { producao: "https://api.pagseguro.com", sandbox: "https://sandbox.api.pagseguro.com" };

export async function configGateway(db: SupabaseClient, donoId: string): Promise<ConfigGateway | null> {
  const { data } = await db.from("gateway_config").select("gateway, token, ambiente, segredo_webhook").eq("dono_id", donoId).maybeSingle();
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
    const msg = j.error_messages?.map((e) => [e.parameter_name, e.description].filter(Boolean).join(": ")).join("; ");
    const erro = new Error(r.status === 401 || r.status === 403 ? "token recusado pelo PagBank (confira se copiou o token certo e o ambiente)" : msg || `PagBank respondeu ${r.status}`);
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
/* Rotas do painel: status, conectar (testa gerando um Pix de R$ 1), remover */
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
    const token = String(corpo.token ?? "").trim();
    const ambiente = corpo.ambiente === "sandbox" ? "sandbox" : "producao";
    if (token.length < 20) return { erro: "Cole o token do PagBank." };
    const { data: atual } = await db.from("gateway_config").select("segredo_webhook").eq("dono_id", donoId).maybeSingle();
    const segredo = atual?.segredo_webhook ?? crypto.randomUUID().replaceAll("-", "");
    const cfg: ConfigGateway = { gateway: "pagbank", token, ambiente, segredo_webhook: segredo };
    try {
      // teste de verdade: gera um Pix de R$ 1,00 que expira sozinho (ninguém precisa pagar)
      await criarPixPagBank(cfg, donoId, { referencia: `teste-${Date.now()}`, descricao: "Teste de conexão XClozr", valorCentavos: 100, expiraMin: 5 });
    } catch (e) {
      return { erro: `Não funcionou: ${(e as Error).message}` };
    }
    const { error } = await db
      .from("gateway_config")
      .upsert({ dono_id: donoId, gateway: "pagbank", token, ambiente, segredo_webhook: segredo, ok: true, erro: null, atualizado_em: new Date().toISOString() });
    if (error) return { erro: "Funcionou, mas não consegui salvar. Tente de novo." };
    await db.from("configuracoes").upsert({ dono_id: donoId, gateway: "pagbank" });
    return { ok: true };
  }
  return { erro: "ação desconhecida" };
}
