/// <reference lib="deno.ns" />
// XClozr — motor do robô (Supabase Edge Function)
// Rotas:
//   POST /motor/simular     → simulador do editor de funil (usa o login do painel)
//   POST /motor/evolution   → webhook da Evolution API (?segredo=...)
//   POST /motor/relogio     → chamado pelo pg_cron a cada poucos segundos (header x-segredo)
//   GET  /motor/saude       → verificação
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as M from "./motor.ts";
import { CAMPOS_CONTATO, criarStore, linhaParaContato } from "./store.ts";
import { configMotor, criarEnvioEvolution, envioSimulado } from "./envio.ts";

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

/* ------------------------------------------------------------------ */
/* Trava por contato: evita responder em dobro                         */
/* ------------------------------------------------------------------ */
async function travar(id: string) {
  const agora = new Date();
  const { data } = await db
    .from("contatos")
    .update({ processando_ate: new Date(agora.getTime() + 45_000).toISOString() })
    .eq("id", id)
    .or(`processando_ate.is.null,processando_ate.lt.${agora.toISOString()}`)
    .select("id");
  return Boolean(data?.length);
}
async function soltar(id: string) {
  await db.from("contatos").update({ processando_ate: null }).eq("id", id);
}

async function carregarContato(id: string) {
  const { data } = await db.from("contatos").select(CAMPOS_CONTATO).eq("id", id).maybeSingle();
  return data ? linhaParaContato(data) : null;
}

async function funilPadraoDe(donoId: string, contato: M.Contato) {
  const store = criarStore(db, donoId);
  if (contato.anuncio_codigo) {
    const { data: an } = await db.from("anuncios").select("funil_id").eq("dono_id", donoId).eq("codigo_rastreio", contato.anuncio_codigo).maybeSingle();
    if (an?.funil_id) {
      const f = await store.funil(an.funil_id);
      if (f) return f;
    }
  }
  const { data } = await db.from("funis").select("id").eq("dono_id", donoId).eq("ativo", true).order("padrao", { ascending: false }).limit(1).maybeSingle();
  return data ? store.funil(data.id) : null;
}

function ctxPara(donoId: string, simulacao: boolean, cfg: Record<string, string>): M.Ctx {
  return {
    store: criarStore(db, donoId),
    envio: simulacao ? envioSimulado : criarEnvioEvolution(db, cfg),
    log: (m) => console.log(`[motor ${donoId.slice(0, 6)}] ${m}`),
  };
}

/* ------------------------------------------------------------------ */
/* Simulador                                                           */
/* ------------------------------------------------------------------ */
async function simular(req: Request) {
  const corpo = await req.json().catch(() => ({}));
  let donoId: string | null = null;
  // teste interno (pelo próprio banco, com o segredo do relógio)
  const segredo = req.headers.get("x-segredo");
  if (segredo) {
    const cfg = await configMotor(db);
    if (cfg.segredo_relogio && segredo === cfg.segredo_relogio && corpo.dono_id) donoId = String(corpo.dono_id);
  } else {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(jwt);
    donoId = u?.user?.id ?? null;
  }
  if (!donoId) return json({ erro: "não autenticado" }, 401);

  const funilId = String(corpo.funil_id ?? "");
  const acao = String(corpo.acao ?? "mensagem");
  const { data: f } = await db.from("funis").select("id").eq("id", funilId).eq("dono_id", donoId).maybeSingle();
  if (!f) return json({ erro: "funil não encontrado" }, 404);

  const telefone = `sim-${funilId.slice(0, 8)}`;
  if (acao === "reiniciar") await db.from("contatos").delete().eq("dono_id", donoId).eq("telefone", telefone);

  let { data: linha } = await db.from("contatos").select(CAMPOS_CONTATO).eq("dono_id", donoId).eq("telefone", telefone).maybeSingle();
  const ctx = ctxPara(donoId, true, {});
  if (!linha) {
    const { data: novo } = await db
      .from("contatos")
      .insert({ dono_id: donoId, telefone, nome: null, simulacao: true, funil_id: funilId })
      .select(CAMPOS_CONTATO)
      .single();
    linha = novo;
    await M.evento(ctx, linhaParaContato(linha), "novo_contato");
  }
  const contato = linhaParaContato(linha);
  const inicio = new Date(Date.now() - 1000).toISOString();
  const funil = await ctx.store.funil(funilId);

  if (acao === "mensagem") {
    const texto = String(corpo.texto ?? "").slice(0, 2000);
    await db.from("mensagens").insert({ dono_id: donoId, contato_id: contato.id, autor: "cliente", tipo: "texto", conteudo: texto });
    await db.from("contatos").update({ ultima_msg_em: new Date().toISOString() }).eq("id", contato.id);
    await M.receberMensagem(ctx, contato, async () => funil, texto);
  } else if (acao === "pagar") {
    if (contato.pix_ativo) {
      await db.from("pagamentos").update({ status: "pago", pago_em: new Date().toISOString() }).eq("id", contato.pix_ativo.pagamento_id);
      await M.pixPago(ctx, contato, contato.pix_ativo.pagamento_id);
    }
  } else if (acao === "avancar") {
    // pula a próxima espera do relógio (lembrete, "não respondeu", Esperar…)
    const { data: prox } = await db
      .from("agendamentos")
      .select("id, tipo, dados")
      .eq("contato_id", contato.id)
      .eq("feito", false)
      .order("executar_em")
      .limit(1)
      .maybeSingle();
    if (prox) {
      await db.from("agendamentos").update({ feito: true }).eq("id", prox.id);
      await M.executarAgendamento(ctx, contato, prox.tipo, prox.dados ?? {});
    }
  }

  const atual = await carregarContato(contato.id);
  const { data: msgs } = await db
    .from("mensagens")
    .select("autor, tipo, conteudo, midia_url, criado_em")
    .eq("contato_id", contato.id)
    .gte("criado_em", acao === "estado" ? "1970-01-01" : inicio)
    .order("criado_em");
  const { data: prox } = await db.from("agendamentos").select("tipo, executar_em").eq("contato_id", contato.id).eq("feito", false).order("executar_em").limit(1).maybeSingle();
  const { data: col } = atual?.kanban_coluna_id ? await db.from("kanban_colunas").select("nome").eq("id", atual.kanban_coluna_id).maybeSingle() : { data: null };

  return json({
    mensagens: (msgs ?? []).filter((m) => acao === "estado" || m.autor === "robo"),
    estado: atual && {
      bloco_atual: atual.bloco_atual,
      aguardando: atual.aguardando?.tipo ?? null,
      pix_pendente: Boolean(atual.pix_ativo),
      finalizado: atual.finalizado,
      robo_ativo: atual.robo_ativo,
      etiquetas: atual.etiquetas,
      campos: atual.campos,
      coluna: col?.nome ?? null,
      proxima_espera: prox ?? null,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Webhook da Evolution                                                */
/* ------------------------------------------------------------------ */
function textoDaMensagem(m: any): string {
  if (!m) return "";
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    (m.audioMessage ? "[áudio]" : m.imageMessage ? "[imagem]" : m.stickerMessage ? "[figurinha]" : m.documentMessage ? "[arquivo]" : "")
  );
}

async function evolution(req: Request, cfg: Record<string, string>) {
  const url = new URL(req.url);
  if (!cfg.segredo_webhook || url.searchParams.get("segredo") !== cfg.segredo_webhook) return json({ erro: "segredo inválido" }, 401);
  const corpo = await req.json().catch(() => null);
  if (!corpo) return json({ ok: true });

  const tipo = String(corpo.event ?? "").toLowerCase().replace(/_/g, ".");
  const instancia = String(corpo.instance ?? "");
  const { data: numero } = await db.from("numeros").select("id, dono_id").eq("instancia", instancia).maybeSingle();
  if (!numero) return json({ ok: true, aviso: "instância desconhecida" });

  if (tipo === "connection.update") {
    const estado = corpo.data?.state;
    const status = estado === "open" ? "conectado" : estado === "close" ? "desconectado" : null;
    if (status) await db.from("numeros").update({ status, conectado_em: status === "conectado" ? new Date().toISOString() : undefined }).eq("id", numero.id);
    return json({ ok: true });
  }
  if (tipo !== "messages.upsert") return json({ ok: true });

  const d = corpo.data ?? {};
  const jid: string = d.key?.remoteJid ?? "";
  if (!jid.endsWith("@s.whatsapp.net")) return json({ ok: true }); // ignora grupos, status, etc.
  const telefone = jid.split("@")[0];
  const texto = textoDaMensagem(d.message);
  const donoId = numero.dono_id;

  let { data: linha } = await db.from("contatos").select(CAMPOS_CONTATO).eq("dono_id", donoId).eq("telefone", telefone).maybeSingle();

  // mensagem enviada pelo próprio celular: se não foi o robô, um humano assumiu → pausa o robô
  if (d.key?.fromMe) {
    if (linha) {
      const { data: ult } = await db
        .from("mensagens")
        .select("conteudo")
        .eq("contato_id", linha.id)
        .eq("autor", "robo")
        .gte("criado_em", new Date(Date.now() - 120_000).toISOString());
      const foiRobo = (ult ?? []).some((m) => (m.conteudo ?? "").trim() === texto.trim());
      if (!foiRobo) {
        await db.from("mensagens").insert({ dono_id: donoId, contato_id: linha.id, autor: "humano", tipo: "texto", conteudo: texto, wa_id: d.key?.id });
        await db.from("contatos").update({ robo_ativo: false }).eq("id", linha.id);
      }
    }
    return json({ ok: true });
  }

  const ctx = ctxPara(donoId, false, cfg);
  if (!linha) {
    const { data: novo } = await db
      .from("contatos")
      .insert({ dono_id: donoId, telefone, nome: d.pushName ?? null, numero_id: numero.id })
      .select(CAMPOS_CONTATO)
      .single();
    linha = novo;
    await M.evento(ctx, linhaParaContato(linha), "novo_contato");
  }
  const contato = linhaParaContato(linha);
  await db.from("mensagens").insert({ dono_id: donoId, contato_id: contato.id, autor: "cliente", tipo: "texto", conteudo: texto, wa_id: d.key?.id });
  await db.from("contatos").update({ ultima_msg_em: new Date().toISOString(), numero_id: numero.id }).eq("id", contato.id);

  if (!(await travar(contato.id))) {
    // outra mensagem do mesmo cliente está sendo processada: tenta de novo em 3 s
    await ctx.store.agendar(contato, "reprocessar", new Date(Date.now() + 3000), { texto });
    return json({ ok: true, enfileirado: true });
  }
  try {
    const atual = (await carregarContato(contato.id))!;
    await M.receberMensagem(ctx, atual, () => funilPadraoDe(donoId, atual), texto);
  } catch (e) {
    console.error("erro ao processar mensagem", e);
  } finally {
    await soltar(contato.id);
  }
  return json({ ok: true });
}

/* ------------------------------------------------------------------ */
/* Relógio (pg_cron)                                                   */
/* ------------------------------------------------------------------ */
async function relogio(req: Request, cfg: Record<string, string>) {
  if (!cfg.segredo_relogio || req.headers.get("x-segredo") !== cfg.segredo_relogio) return json({ erro: "segredo inválido" }, 401);
  const { data: vencidos } = await db
    .from("agendamentos")
    .select("id, dono_id, contato_id, tipo, dados")
    .eq("feito", false)
    .lte("executar_em", new Date().toISOString())
    .order("executar_em")
    .limit(40);

  let feitos = 0;
  for (const a of vencidos ?? []) {
    // "reivindica" a tarefa (se duas execuções do relógio se cruzarem, só uma pega)
    const { data: pegou } = await db.from("agendamentos").update({ feito: true }).eq("id", a.id).eq("feito", false).select("id");
    if (!pegou?.length) continue;
    if (!(await travar(a.contato_id))) {
      await db.from("agendamentos").update({ feito: false, executar_em: new Date(Date.now() + 3000).toISOString() }).eq("id", a.id);
      continue;
    }
    try {
      const contato = await carregarContato(a.contato_id);
      if (!contato) continue;
      const ctx = ctxPara(a.dono_id, contato.simulacao, cfg);
      if (a.tipo === "reprocessar") {
        await M.receberMensagem(ctx, contato, () => funilPadraoDe(a.dono_id, contato), String(a.dados?.texto ?? ""));
      } else {
        await M.executarAgendamento(ctx, contato, a.tipo, a.dados ?? {});
      }
      feitos++;
    } catch (e) {
      console.error("erro no agendamento", a.id, e);
    } finally {
      await soltar(a.contato_id);
    }
  }
  return json({ ok: true, feitos });
}

/* ------------------------------------------------------------------ */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const rota = new URL(req.url).pathname.replace(/^.*\/motor/, "") || "/";
  try {
    if (rota === "/saude") return json({ ok: true, motor: "xclozr", hora: new Date().toISOString() });
    if (rota === "/simular" && req.method === "POST") return await simular(req);
    const cfg = await configMotor(db);
    if (rota === "/evolution" && req.method === "POST") return await evolution(req, cfg);
    if (rota === "/relogio" && req.method === "POST") return await relogio(req, cfg);
    return json({ erro: "rota não encontrada" }, 404);
  } catch (e) {
    console.error(e);
    return json({ erro: "falha interna" }, 500);
  }
});
