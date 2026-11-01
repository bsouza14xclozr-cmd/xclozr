// Rotas do painel para conectar números (chips) via Evolution API.
// A apikey da Evolution fica só no servidor (motor_config) — nunca volta para o navegador.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { configMotor } from "./envio.ts";

const EVENTOS = ["MESSAGES_UPSERT", "CONNECTION_UPDATE"];

type Cfg = Record<string, string>;

function base(cfg: Cfg) {
  return (cfg.evolution_url ?? "").trim().replace(/\/+$/, "");
}

async function evo(cfg: Cfg, metodo: string, rota: string, corpo?: unknown) {
  const r = await fetch(`${base(cfg)}${rota}`, {
    method: metodo,
    headers: { "content-type": "application/json", apikey: cfg.evolution_apikey ?? "" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await r.text();
  let dados: any = null;
  try {
    dados = JSON.parse(texto);
  } catch {
    dados = texto;
  }
  return { ok: r.ok, status: r.status, dados };
}

function urlWebhook(cfg: Cfg) {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/motor/evolution?segredo=${encodeURIComponent(cfg.segredo_webhook ?? "")}`;
}

async function definirWebhook(cfg: Cfg, inst: string) {
  const url = urlWebhook(cfg);
  const novo = await evo(cfg, "POST", `/webhook/set/${encodeURIComponent(inst)}`, {
    webhook: { enabled: true, url, byEvents: false, base64: false, events: EVENTOS },
  });
  if (novo.ok) return true;
  // formato das versões 2.0/2.1
  const antigo = await evo(cfg, "POST", `/webhook/set/${encodeURIComponent(inst)}`, {
    enabled: true,
    url,
    webhookByEvents: false,
    webhookBase64: false,
    events: EVENTOS,
  });
  return antigo.ok;
}

function qrDe(d: any): string | null {
  const b = d?.base64 ?? d?.qrcode?.base64 ?? null;
  if (!b || typeof b !== "string") return null;
  return b.startsWith("data:") ? b : `data:image/png;base64,${b}`;
}

function telefoneDe(d: any): string | null {
  const jid: string | undefined = d?.ownerJid ?? d?.owner ?? d?.instance?.owner ?? d?.instance?.wuid;
  return jid ? jid.split("@")[0].split(":")[0] : null;
}

async function estadoEvolution(cfg: Cfg, inst: string) {
  const r = await evo(cfg, "GET", `/instance/connectionState/${encodeURIComponent(inst)}`);
  if (r.status === 404) return "inexistente";
  const s = r.dados?.instance?.state ?? r.dados?.state ?? null;
  return s === "open" ? "conectado" : s === "connecting" ? "conectando" : "desconectado";
}

export async function rotasNumeros(db: SupabaseClient, donoId: string, corpo: any) {
  const acao = String(corpo.acao ?? "");
  let cfg = await configMotor(db);
  const configurada = Boolean(base(cfg) && cfg.evolution_apikey);

  // Só o dono principal do painel mexe no servidor da Evolution.
  if (cfg.dono_admin && cfg.dono_admin !== donoId && acao === "config") return { status: 403, dados: { erro: "sem permissão" } };

  if (acao === "status") {
    let host: string | null = null;
    try {
      host = configurada ? new URL(base(cfg)).host : null;
    } catch {
      host = null;
    }
    return { status: 200, dados: { configurada, servidor: host } };
  }

  if (acao === "config") {
    const url = String(corpo.url ?? "").trim().replace(/\/+$/, "");
    const apikey = String(corpo.apikey ?? "").trim() || cfg.evolution_apikey || "";
    if (!/^https?:\/\/[^\s]+$/i.test(url)) return { status: 400, dados: { erro: "Endereço inválido. Ex.: https://evolution.seudominio.com" } };
    if (!apikey) return { status: 400, dados: { erro: "Informe a API key global da Evolution." } };
    const teste = { ...cfg, evolution_url: url, evolution_apikey: apikey };
    let r;
    try {
      r = await evo(teste, "GET", "/instance/fetchInstances");
    } catch {
      return { status: 400, dados: { erro: "Não consegui acessar esse endereço. Confira se a Evolution está no ar e acessível pela internet (https)." } };
    }
    if (r.status === 401 || r.status === 403) return { status: 400, dados: { erro: "A Evolution recusou a API key. Confira a AUTHENTICATION_API_KEY do servidor." } };
    if (!r.ok) return { status: 400, dados: { erro: `A Evolution respondeu com erro ${r.status}.` } };
    const linhas = [
      { chave: "evolution_url", valor: url },
      { chave: "evolution_apikey", valor: apikey },
      ...(cfg.dono_admin ? [] : [{ chave: "dono_admin", valor: donoId }]),
    ];
    const { error } = await db.from("motor_config").upsert(linhas, { onConflict: "chave" });
    if (error) return { status: 500, dados: { erro: "Não consegui salvar." } };
    // reaplica o webhook nos números que já existem (caso o endereço tenha mudado)
    cfg = await configMotor(db);
    const { data: nums } = await db.from("numeros").select("instancia").eq("dono_id", donoId);
    for (const n of nums ?? []) await definirWebhook(cfg, n.instancia).catch(() => false);
    return { status: 200, dados: { ok: true, servidor: new URL(url).host } };
  }

  if (!configurada) return { status: 400, dados: { erro: "Configure o servidor da Evolution primeiro." } };

  if (acao === "criar") {
    const nome = String(corpo.nome ?? "").trim().slice(0, 60) || "Chip";
    const inst = `xc-${donoId.slice(0, 6)}-${crypto.randomUUID().slice(0, 8)}`;
    const r = await evo(cfg, "POST", "/instance/create", {
      instanceName: inst,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      groupsIgnore: true,
      webhook: { enabled: true, url: urlWebhook(cfg), byEvents: false, base64: false, events: EVENTOS },
    });
    if (!r.ok) {
      const msg = typeof r.dados === "object" ? JSON.stringify(r.dados?.response?.message ?? r.dados?.message ?? r.dados).slice(0, 200) : String(r.dados).slice(0, 200);
      return { status: 400, dados: { erro: `A Evolution não criou a instância (${r.status}): ${msg}` } };
    }
    await definirWebhook(cfg, inst).catch(() => false);
    const { data: linha, error } = await db
      .from("numeros")
      .insert({ dono_id: donoId, nome, instancia: inst, status: "conectando" })
      .select("id")
      .single();
    if (error || !linha) return { status: 500, dados: { erro: "Instância criada, mas não consegui salvar no painel." } };
    let qr = qrDe(r.dados?.qrcode ?? r.dados);
    if (!qr) {
      const c = await evo(cfg, "GET", `/instance/connect/${encodeURIComponent(inst)}`);
      qr = qrDe(c.dados);
    }
    return { status: 200, dados: { id: linha.id, qr } };
  }

  const { data: numero } = await db.from("numeros").select("id, instancia, status").eq("id", String(corpo.numero_id ?? "")).eq("dono_id", donoId).maybeSingle();
  if (!numero) return { status: 404, dados: { erro: "Número não encontrado." } };
  const inst = numero.instancia;

  if (acao === "qr") {
    let estado = await estadoEvolution(cfg, inst);
    if (estado === "inexistente") {
      await evo(cfg, "POST", "/instance/create", { instanceName: inst, integration: "WHATSAPP-BAILEYS", qrcode: true, groupsIgnore: true });
      await definirWebhook(cfg, inst).catch(() => false);
      estado = "desconectado";
    }
    if (estado === "conectado") return { status: 200, dados: { conectado: true, qr: null } };
    const c = await evo(cfg, "GET", `/instance/connect/${encodeURIComponent(inst)}`);
    await db.from("numeros").update({ status: "conectando" }).eq("id", numero.id);
    return { status: 200, dados: { conectado: false, qr: qrDe(c.dados) } };
  }

  if (acao === "estado") {
    const estado = await estadoEvolution(cfg, inst);
    const status = estado === "inexistente" ? "desconectado" : estado;
    const patch: Record<string, unknown> = { status };
    if (status === "conectado") {
      const f = await evo(cfg, "GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(inst)}`);
      const item = Array.isArray(f.dados) ? f.dados[0] : f.dados;
      const tel = telefoneDe(item);
      if (tel) patch.telefone = tel;
      if (numero.status !== "conectado") patch.conectado_em = new Date().toISOString();
    }
    await db.from("numeros").update(patch).eq("id", numero.id);
    return { status: 200, dados: { status, telefone: patch.telefone ?? null } };
  }

  if (acao === "desconectar") {
    await evo(cfg, "DELETE", `/instance/logout/${encodeURIComponent(inst)}`);
    await db.from("numeros").update({ status: "desconectado" }).eq("id", numero.id);
    return { status: 200, dados: { ok: true } };
  }

  if (acao === "apagar") {
    await evo(cfg, "DELETE", `/instance/logout/${encodeURIComponent(inst)}`).catch(() => null);
    await evo(cfg, "DELETE", `/instance/delete/${encodeURIComponent(inst)}`).catch(() => null);
    await db.from("numeros").delete().eq("id", numero.id);
    return { status: 200, dados: { ok: true } };
  }

  return { status: 400, dados: { erro: "ação desconhecida" } };
}
