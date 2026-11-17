// supabase/functions/pagamentos/index.ts
import { createClient } from "@supabase/supabase-js";

// supabase/functions/pagamentos/gateway.ts
var BASE = { producao: "https://api.pagseguro.com", sandbox: "https://sandbox.api.pagseguro.com" };
function urlAviso(donoId, segredo) {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/motor/pagbank?d=${donoId}&s=${segredo}`;
}
async function chamar(cfg, metodo, caminho, corpo) {
  const r = await fetch(`${BASE[cfg.ambiente]}${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json", accept: "application/json" },
    body: corpo ? JSON.stringify(corpo) : void 0,
    signal: AbortSignal.timeout(2e4)
  });
  const texto = await r.text();
  let j = {};
  try {
    j = JSON.parse(texto);
  } catch {
  }
  if (!r.ok) {
    const msg = (j.error_messages?.map((e) => [e.code, e.parameter_name, e.description].filter(Boolean).join(": ")).join("; ") || texto.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 220);
    let explicacao = msg || "sem detalhes";
    if (r.status === 401) explicacao = `token inválido para o ambiente ${cfg.ambiente === "sandbox" ? "Sandbox" : "Produção"} (${msg || "UNAUTHORIZED"})`;
    else if (r.status === 403 && /whitelist|allowlist|access_denied|não autorizad/i.test(msg)) explicacao = `sua conta ainda não está liberada para gerar Pix pela API (${msg})`;
    const erro = new Error(`PagBank recusou (${r.status}): ${explicacao}`);
    erro.parametros = (j.error_messages ?? []).map((e) => e.parameter_name ?? "").join(",");
    throw erro;
  }
  return j;
}
function telefoneBR(tel) {
  const d = (tel ?? "").replace(/\D/g, "");
  const m = d.match(/^55(\d{2})(\d{8,9})$/);
  return m ? [{ country: "55", area: m[1], number: m[2], type: "MOBILE" }] : void 0;
}
async function criarPixPagBank(cfg, donoId, p) {
  const expira = new Date(Date.now() + Math.max(5, Math.min(p.expiraMin, 60 * 24 * 7)) * 6e4);
  const base = {
    reference_id: p.referencia,
    items: [{ reference_id: p.referencia.slice(0, 64), name: (p.descricao || "Produto").slice(0, 64), quantity: 1, unit_amount: p.valorCentavos }],
    qr_codes: [{ amount: { value: p.valorCentavos }, expiration_date: expira.toISOString().replace(/\.\d{3}Z$/, "Z") }],
    notification_urls: [urlAviso(donoId, cfg.segredo_webhook)]
  };
  const cliente = { name: (p.nome || "Cliente").replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 60) || "Cliente", phones: p.telefone ? telefoneBR(p.telefone) : void 0 };
  let r;
  try {
    r = await chamar(cfg, "POST", "/orders", { ...base, customer: cliente });
  } catch (e) {
    if (!/customer/i.test(`${e.message} ${e.parametros ?? ""}`)) throw e;
    r = await chamar(cfg, "POST", "/orders", base);
  }
  const qr = r.qr_codes?.[0];
  if (!qr?.text || !r.id) throw new Error("o PagBank não devolveu o código Pix (confira se sua conta tem uma chave Pix cadastrada)");
  return { pedidoId: r.id, copiaCola: qr.text, qrPng: qr.links?.find((l) => l.rel === "QRCODE.PNG")?.href ?? null };
}
var LP_API = "https://api.livepix.gg";
var LP_TOKEN = "https://oauth.livepix.gg/oauth2/token";
var LP_ESCOPOS = ["payments:read payments:write webhooks", "payments:read payments:write", ""];
function credenciaisLivePix(cfg) {
  const i = cfg.token.indexOf(":");
  return { id: cfg.token.slice(0, i), segredo: cfg.token.slice(i + 1) };
}
function erroLivePix(status, texto) {
  let j = {};
  try {
    j = JSON.parse(texto);
  } catch {
  }
  const msg = (j.error_description || j.message || j.error || texto.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "sem detalhes").slice(0, 220);
  if (status === 401 || /invalid_client/i.test(msg)) return new Error(`LivePix recusou (${status}): Client ID ou Client Secret errado (${msg})`);
  if (status === 403) return new Error(`LivePix recusou (403): a aplicação não tem permissão para pagamentos — marque as permissões de pagamentos e webhooks na aplicação (${msg})`);
  if (status === 429) return new Error("LivePix pediu para esperar (muitas chamadas seguidas). Tente de novo em 1 minuto.");
  return new Error(`LivePix recusou (${status}): ${msg}`);
}
async function tokenLivePix(db2, donoId, cfg, renovar = false) {
  if (!renovar && cfg.acesso_token && cfg.acesso_expira && new Date(cfg.acesso_expira).getTime() > Date.now() + 12e4) return cfg.acesso_token;
  const { id, segredo } = credenciaisLivePix(cfg);
  let ultimo = null;
  for (const escopo of LP_ESCOPOS) {
    const corpo = new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: segredo });
    if (escopo) corpo.set("scope", escopo);
    const r = await fetch(LP_TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: corpo, signal: AbortSignal.timeout(2e4) });
    const texto = await r.text();
    if (r.ok) {
      const j = JSON.parse(texto);
      cfg.acesso_token = j.access_token;
      cfg.acesso_expira = new Date(Date.now() + (j.expires_in ?? 3600) * 1e3).toISOString();
      await db2.from("gateway_config").update({ acesso_token: cfg.acesso_token, acesso_expira: cfg.acesso_expira }).eq("dono_id", donoId).eq("gateway", "livepix");
      return j.access_token;
    }
    ultimo = erroLivePix(r.status, texto);
    if (!/scope/i.test(texto)) break;
  }
  throw ultimo ?? new Error("LivePix não devolveu o token");
}
async function livePix(db2, donoId, cfg, metodo, caminho, corpo) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const token = await tokenLivePix(db2, donoId, cfg, tentativa > 0);
    const r = await fetch(`${LP_API}${caminho}`, {
      method: metodo,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: corpo ? JSON.stringify(corpo) : void 0,
      signal: AbortSignal.timeout(2e4)
    });
    const texto = await r.text();
    if (r.status === 401 && tentativa === 0) continue;
    if (!r.ok) throw erroLivePix(r.status, texto);
    return texto ? JSON.parse(texto) : {};
  }
  throw new Error("LivePix recusou o token");
}
function urlRetornoLivePix(donoId, segredo, pagamentoId) {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/motor/livepix-volta?d=${donoId}&s=${segredo}&p=${pagamentoId}`;
}
function urlAvisoLivePix(donoId, segredo) {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/motor/livepix?d=${donoId}&s=${segredo}`;
}
async function criarCobrancaLivePix(db2, cfg, donoId, p) {
  const r = await livePix(db2, donoId, cfg, "POST", "/v2/payments", {
    amount: p.valorCentavos,
    currency: "BRL",
    redirectUrl: urlRetornoLivePix(donoId, cfg.segredo_webhook, p.pagamentoId)
  });
  const ref = r.data?.reference;
  const link = r.data?.redirectUrl;
  if (!ref || !link) throw new Error("a LivePix não devolveu o link de pagamento");
  return { referencia: ref, link };
}
async function registrarAvisoLivePix(db2, cfg, donoId) {
  const url = urlAvisoLivePix(donoId, cfg.segredo_webhook);
  const lista = await livePix(db2, donoId, cfg, "GET", "/v2/webhooks");
  if ((lista.data ?? []).some((w) => w.url === url)) return;
  for (const w of lista.data ?? []) if (w.url.includes("/functions/v1/motor/livepix")) await livePix(db2, donoId, cfg, "DELETE", `/v2/webhooks/${w.id}`).catch(() => null);
  await livePix(db2, donoId, cfg, "POST", "/v2/webhooks", { url });
}
var ASAAS = { producao: "https://api.asaas.com/v3", sandbox: "https://api-sandbox.asaas.com/v3" };
async function asaas(cfg, metodo, caminho, corpo) {
  const r = await fetch(`${ASAAS[cfg.ambiente]}${caminho}`, {
    method: metodo,
    headers: { access_token: cfg.token, "content-type": "application/json", accept: "application/json", "user-agent": "XClozr" },
    body: corpo ? JSON.stringify(corpo) : void 0,
    signal: AbortSignal.timeout(2e4)
  });
  const texto = await r.text();
  let j = {};
  try {
    j = JSON.parse(texto);
  } catch {
  }
  if (!r.ok) {
    const msg = (j.errors?.map((e) => e.description || e.code).join("; ") || texto.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "sem detalhes").slice(0, 220);
    if (r.status === 401) throw new Error(`Asaas recusou (401): chave de API inválida para o ambiente ${cfg.ambiente === "sandbox" ? "Sandbox" : "Produção"} (${msg})`);
    throw new Error(`Asaas recusou (${r.status}): ${msg}`);
  }
  return j;
}
async function chavePixAsaas(cfg) {
  const r = await asaas(cfg, "GET", "/pix/addressKeys?status=ACTIVE&limit=10");
  return r.data?.find((k) => k.key)?.key ?? null;
}
async function criarPixAsaas(cfg, p) {
  if (!cfg.chave_pix) throw new Error("nenhuma chave Pix ativa na conta Asaas (cadastre uma no app Asaas → Pix → Minhas chaves e conecte de novo)");
  const r = await asaas(cfg, "POST", "/pix/qrCodes/static", {
    addressKey: cfg.chave_pix,
    description: (p.descricao || "Produto").slice(0, 37),
    value: Math.round(p.valorCentavos) / 100,
    format: "PAYLOAD",
    expirationSeconds: Math.max(300, Math.min(p.expiraMin, 60 * 24 * 7) * 60),
    allowsMultiplePayments: false,
    externalReference: p.pagamentoId
  });
  if (!r.id || !r.payload) throw new Error("o Asaas não devolveu o código Pix");
  return { qrId: r.id, copiaCola: r.payload };
}
function urlAvisoAsaas(donoId, segredo) {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/motor/asaas?d=${donoId}&s=${segredo}`;
}
async function registrarAvisoAsaas(cfg, donoId, email) {
  const url = urlAvisoAsaas(donoId, cfg.segredo_webhook);
  const lista = await asaas(cfg, "GET", "/webhooks?limit=100");
  if ((lista.data ?? []).some((w) => w.url === url)) return;
  for (const w of lista.data ?? []) if (w.url.includes("/functions/v1/motor/asaas")) await asaas(cfg, "DELETE", `/webhooks/${w.id}`).catch(() => null);
  await asaas(cfg, "POST", "/webhooks", {
    name: "XClozr - robô de vendas",
    url,
    email,
    enabled: true,
    interrupted: false,
    sendType: "SEQUENTIALLY",
    events: ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]
  });
}
async function rotaGateway(db2, donoId, corpo) {
  const acao = String(corpo.acao ?? "status");
  if (acao === "status") {
    const { data } = await db2.from("gateway_config").select("gateway, ambiente, ok, erro, atualizado_em").eq("dono_id", donoId).maybeSingle();
    return { conectado: Boolean(data), ...data ?? {} };
  }
  if (acao === "remover") {
    await db2.from("gateway_config").delete().eq("dono_id", donoId);
    return { ok: true };
  }
  if (acao === "conectar") {
    const qual = corpo.gateway === "livepix" ? "livepix" : corpo.gateway === "asaas" ? "asaas" : "pagbank";
    let aviso = null;
    const { data: atual } = await db2.from("gateway_config").select("segredo_webhook").eq("dono_id", donoId).maybeSingle();
    const segredo = atual?.segredo_webhook ?? crypto.randomUUID().replaceAll("-", "");
    let cfg;
    if (qual === "asaas") {
      const token = String(corpo.token ?? "").trim();
      const ambiente = corpo.ambiente === "sandbox" ? "sandbox" : "producao";
      if (token.length < 20) return { erro: "Cole a chave de API do Asaas." };
      cfg = { gateway: "asaas", token, ambiente, segredo_webhook: segredo };
      try {
        cfg.chave_pix = await chavePixAsaas(cfg);
        if (!cfg.chave_pix) return { erro: "Não funcionou: sua conta Asaas não tem chave Pix ativa. Cadastre uma (app Asaas → Pix → Minhas chaves) e tente de novo." };
        const t = await criarPixAsaas(cfg, { pagamentoId: "teste-xclozr", descricao: "Teste XClozr", valorCentavos: 100, expiraMin: 5 });
        await asaas(cfg, "DELETE", `/pix/qrCodes/static/${t.qrId}`).catch(() => null);
      } catch (e) {
        return { erro: `Não funcionou: ${e.message}` };
      }
      try {
        const { data: u } = await db2.auth.admin.getUserById(donoId);
        await registrarAvisoAsaas(cfg, donoId, u?.user?.email ?? "contato@xclozr.app");
      } catch (e) {
        aviso = `Conectado! Só não consegui cadastrar o aviso automático (${e.message}); o robô confere os pagamentos a cada minuto.`;
      }
    } else if (qual === "livepix") {
      const id = String(corpo.client_id ?? "").trim();
      const sec = String(corpo.client_secret ?? "").trim();
      if (id.length < 8 || sec.length < 8) return { erro: "Cole o Client ID e o Client Secret da aplicação LivePix." };
      cfg = { gateway: "livepix", token: `${id}:${sec}`, ambiente: "producao", segredo_webhook: segredo };
      try {
        await criarCobrancaLivePix(db2, cfg, donoId, { pagamentoId: "teste", valorCentavos: 100 });
        await registrarAvisoLivePix(db2, cfg, donoId);
      } catch (e) {
        return { erro: `Não funcionou: ${e.message}` };
      }
    } else {
      const token = String(corpo.token ?? "").trim();
      const ambiente = corpo.ambiente === "sandbox" ? "sandbox" : "producao";
      if (token.length < 20) return { erro: "Cole o token do PagBank." };
      cfg = { gateway: "pagbank", token, ambiente, segredo_webhook: segredo };
      try {
        await criarPixPagBank(cfg, donoId, { referencia: `teste-${Date.now()}`, descricao: "Teste de conexão XClozr", valorCentavos: 100, expiraMin: 5 });
      } catch (e) {
        return { erro: `Não funcionou: ${e.message}` };
      }
    }
    const { error } = await db2.from("gateway_config").upsert({
      dono_id: donoId,
      gateway: cfg.gateway,
      token: cfg.token,
      ambiente: cfg.ambiente,
      segredo_webhook: segredo,
      acesso_token: cfg.acesso_token ?? null,
      acesso_expira: cfg.acesso_expira ?? null,
      chave_pix: cfg.chave_pix ?? null,
      ok: true,
      erro: null,
      atualizado_em: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (error) return { erro: "Funcionou, mas não consegui salvar. Tente de novo." };
    await db2.from("configuracoes").upsert({ dono_id: donoId, gateway: cfg.gateway });
    return aviso ? { ok: true, aviso } : { ok: true };
  }
  return { erro: "ação desconhecida" };
}

// supabase/functions/pagamentos/index.ts
var db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false }
});
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "content-type": "application/json" } });
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
