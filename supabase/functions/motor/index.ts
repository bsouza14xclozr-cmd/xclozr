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
import { rotasNumeros } from "./numeros.ts";
import { MODELO_PADRAO, responderIA, testarIA, type Provedor } from "./ia.ts";
import { ETIQUETA_SAIR, ehPedidoSair, processarDisparos } from "./disparos.ts";
import { configGateway, pedidoPago, rotaGateway } from "./gateway.ts";

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
    ia: (c, cfgBloco) => responderIA(db, donoId, c, cfgBloco),
  };
}

// Configuração do agente de IA (a chave só entra; nunca volta para o navegador)
async function rotaIA(req: Request) {
  const donoId = await usuarioDoJwt(req);
  if (!donoId) return json({ erro: "não autenticado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const acao = String(corpo.acao ?? "status");
  const { data: atual } = await db.from("ia_config").select("provedor, modelo, chave").eq("dono_id", donoId).maybeSingle();
  if (acao === "status") {
    return json({ configurada: Boolean(atual), provedor: atual?.provedor ?? null, modelo: atual?.modelo ?? null, final_chave: atual?.chave ? atual.chave.slice(-4) : null, padroes: MODELO_PADRAO });
  }
  if (acao === "apagar") {
    await db.from("ia_config").delete().eq("dono_id", donoId);
    return json({ ok: true });
  }
  if (acao === "salvar") {
    const provedor = String(corpo.provedor ?? "") as Provedor;
    if (!["openai", "anthropic", "gemini"].includes(provedor)) return json({ erro: "Escolha a IA." }, 400);
    const modelo = String(corpo.modelo ?? "").trim() || MODELO_PADRAO[provedor];
    const chave = String(corpo.chave ?? "").trim() || (atual?.provedor === provedor ? atual.chave : "");
    if (!chave) return json({ erro: "Cole a chave de API." }, 400);
    try {
      await testarIA({ provedor, modelo, chave });
    } catch (e) {
      return json({ erro: `A ${provedor === "openai" ? "OpenAI" : provedor === "anthropic" ? "Anthropic" : "Google"} recusou: ${(e as Error).message}`.slice(0, 300) }, 400);
    }
    const { error } = await db.from("ia_config").upsert({ dono_id: donoId, provedor, modelo, chave, atualizado_em: new Date().toISOString() });
    if (error) return json({ erro: "Não consegui salvar." }, 500);
    return json({ ok: true, provedor, modelo, final_chave: chave.slice(-4) });
  }
  return json({ erro: "ação desconhecida" }, 400);
}

/* ------------------------------------------------------------------ */
/* Simulador                                                           */
/* ------------------------------------------------------------------ */
async function usuarioDoJwt(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data: u } = await db.auth.getUser(jwt);
  return u?.user?.id ?? null;
}

async function numeros(req: Request) {
  const donoId = await usuarioDoJwt(req);
  if (!donoId) return json({ erro: "não autenticado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const r = await rotasNumeros(db, donoId, corpo);
  return json(r.dados, r.status);
}

// Conexão do gateway de Pix (o token só entra; nunca volta para o navegador)
async function gateway(req: Request) {
  const donoId = await usuarioDoJwt(req);
  if (!donoId) return json({ erro: "não autenticado" }, 401);
  const r = await rotaGateway(db, donoId, await req.json().catch(() => ({})));
  return json(r, "erro" in r && r.erro ? 400 : 200);
}

/* ------------------------------------------------------------------ */
/* Pagamento confirmado pelo gateway                                   */
/* ------------------------------------------------------------------ */
async function confirmarPagamento(pagamentoId: string, cfg: Record<string, string>) {
  const { data: pg } = await db
    .from("pagamentos")
    .update({ status: "pago", pago_em: new Date().toISOString(), verificar_em: null })
    .eq("id", pagamentoId)
    .neq("status", "pago")
    .select("id, contato_id, dono_id")
    .maybeSingle();
  if (!pg) return false; // já estava pago (aviso repetido)
  for (let i = 0; i < 8; i++) {
    if (await travar(pg.contato_id)) {
      try {
        const contato = await carregarContato(pg.contato_id);
        if (contato) {
          const esperado = contato.pix_ativo?.pagamento_id === pg.id;
          await M.pixPago(ctxPara(pg.dono_id, false, cfg), contato, pg.id);
          if (!esperado) {
            await db.from("avisos").insert({
              dono_id: pg.dono_id,
              contato_id: pg.contato_id,
              tipo: "venda",
              texto: `Pix pago fora da hora (depois de expirar ou de outra conversa) por ${contato.nome ?? contato.telefone}. Confira e entregue manualmente em Conversas.`,
              link: "/conversas",
            });
          }
        }
      } finally {
        await soltar(pg.contato_id);
      }
      return true;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  // contato ocupado demais: deixa o relógio continuar daqui
  await db.from("agendamentos").insert({ dono_id: pg.dono_id, contato_id: pg.contato_id, tipo: "pix_pago", dados: { pagamento_id: pg.id }, executar_em: new Date(Date.now() + 5000).toISOString() });
  return true;
}

// Aviso do PagBank (?d=dono&s=segredo). Não confia no corpo: consulta o pedido na API.
async function avisoPagBank(req: Request, cfg: Record<string, string>) {
  const u = new URL(req.url);
  const donoId = u.searchParams.get("d") ?? "";
  const corpo = await req.json().catch(() => ({}));
  const gw = /^[0-9a-f-]{36}$/.test(donoId) ? await configGateway(db, donoId) : null;
  if (!gw || u.searchParams.get("s") !== gw.segredo_webhook) return json({ erro: "aviso inválido" }, 401);
  const pedidoId = String(corpo?.id ?? "");
  if (!pedidoId.startsWith("ORDE_")) return json({ ok: true, ignorado: true });
  const { data: pg } = await db.from("pagamentos").select("id, status").eq("dono_id", donoId).eq("gateway_id", pedidoId).maybeSingle();
  if (!pg || pg.status === "pago") return json({ ok: true });
  const r = await pedidoPago(gw, pedidoId);
  if (r.pago) await confirmarPagamento(pg.id, cfg);
  return json({ ok: true, pago: r.pago });
}

// Confere no PagBank os Pix pendentes (rede de segurança se o aviso se perder)
async function conferirPendentes(cfg: Record<string, string>) {
  const agora = new Date();
  const { data: pendentes } = await db
    .from("pagamentos")
    .select("id, dono_id, gateway_id, criado_em")
    .eq("status", "pendente")
    .eq("gateway", "pagbank")
    .not("gateway_id", "is", null)
    .lte("verificar_em", agora.toISOString())
    .order("verificar_em")
    .limit(8);
  let pagos = 0;
  for (const p of pendentes ?? []) {
    const idadeMin = (agora.getTime() - new Date(p.criado_em).getTime()) / 60_000;
    // confere a cada 1 min na 1ª hora, depois a cada 10 min, e para depois de 2 dias
    const prox = idadeMin > 2880 ? null : new Date(agora.getTime() + (idadeMin < 60 ? 60_000 : 600_000)).toISOString();
    await db.from("pagamentos").update({ verificar_em: prox }).eq("id", p.id);
    try {
      const gw = await configGateway(db, p.dono_id);
      if (!gw) continue;
      const r = await pedidoPago(gw, p.gateway_id);
      if (r.pago && (await confirmarPagamento(p.id, cfg))) pagos++;
    } catch (e) {
      console.error("conferir Pix", p.id, e);
    }
  }
  return pagos;
}

// Resposta manual pelo painel (tela Conversas)
async function enviarManual(req: Request) {
  const donoId = await usuarioDoJwt(req);
  if (!donoId) return json({ erro: "não autenticado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const texto = String(corpo.texto ?? "").trim().slice(0, 4000);
  if (!texto) return json({ erro: "mensagem vazia" }, 400);
  const { data: linha } = await db.from("contatos").select(CAMPOS_CONTATO).eq("id", String(corpo.contato_id ?? "")).eq("dono_id", donoId).maybeSingle();
  if (!linha) return json({ erro: "conversa não encontrada" }, 404);
  const contato = linhaParaContato(linha);
  if (contato.simulacao) return json({ erro: "conversa de simulação" }, 400);
  const cfg = await configMotor(db);
  try {
    await criarEnvioEvolution(db, cfg).enviar(contato, { tipo: "texto", texto, esperaMs: 0 });
  } catch (e) {
    return json({ erro: `Não consegui enviar: ${(e as Error).message}` }, 400);
  }
  await db.from("mensagens").insert({ dono_id: donoId, contato_id: contato.id, autor: "humano", tipo: "texto", conteudo: texto });
  const patch: Record<string, unknown> = { ultima_msg_em: new Date().toISOString() };
  if (corpo.pausar_robo !== false) patch.robo_ativo = false;
  await db.from("contatos").update(patch).eq("id", contato.id);
  return json({ ok: true });
}

async function simular(req: Request) {
  const corpo = await req.json().catch(() => ({}));
  let donoId: string | null = null;
  // teste interno (pelo próprio banco, com o segredo do relógio)
  const segredo = req.headers.get("x-segredo");
  if (segredo) {
    const cfg = await configMotor(db);
    if (cfg.segredo_relogio && segredo === cfg.segredo_relogio && corpo.dono_id) donoId = String(corpo.dono_id);
  } else {
    donoId = await usuarioDoJwt(req);
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

// Anúncio de origem (Click-to-WhatsApp): vem na 1ª mensagem em contextInfo.externalAdReply
function anuncioDaMensagem(d: any): { id: string; ctwa: string | null; origem: Record<string, unknown> } | null {
  const m = d?.message ?? {};
  const ctx = m.extendedTextMessage?.contextInfo ?? m.imageMessage?.contextInfo ?? m.videoMessage?.contextInfo ?? m.contextInfo ?? d?.contextInfo ?? null;
  const ad = ctx?.externalAdReply ?? d?.contextInfo?.externalAdReply ?? null;
  const ref = d?.adReferral ?? d?.referral ?? null;
  const id = ad?.sourceId ?? ref?.sourceId ?? ref?.source_id;
  if (!id) return null;
  if (ad?.sourceType && String(ad.sourceType).toLowerCase() !== "ad") return null;
  return {
    id: String(id),
    ctwa: ad?.ctwaClid ?? ref?.ctwaClid ?? ref?.ctwa_clid ?? null,
    origem: { url: ad?.sourceUrl ?? ref?.sourceUrl ?? ref?.source_url ?? null, titulo: ad?.title ?? null, texto: ad?.body ?? null, em: new Date().toISOString() },
  };
}

async function evolution(req: Request, cfg: Record<string, string>) {
  const url = new URL(req.url);
  if (!cfg.segredo_webhook || url.searchParams.get("segredo") !== cfg.segredo_webhook) return json({ erro: "segredo inválido" }, 401);
  const corpo = await req.json().catch(() => null);
  if (!corpo) return json({ ok: true });

  const tipo = String(corpo.event ?? "").toLowerCase().replace(/_/g, ".");
  const instancia = String(corpo.instance ?? "");
  const { data: numero } = await db.from("numeros").select("id, dono_id, robo_ligado").eq("instancia", instancia).maybeSingle();
  if (!numero) return json({ ok: true, aviso: "instância desconhecida" });

  if (tipo === "connection.update") {
    const estado = corpo.data?.state;
    const status = estado === "open" ? "conectado" : estado === "close" ? "desconectado" : null;
    const wuid: string | undefined = corpo.data?.wuid;
    if (status)
      await db
        .from("numeros")
        .update({
          status,
          ...(status === "conectado" ? { conectado_em: new Date().toISOString() } : {}),
          ...(wuid ? { telefone: wuid.split("@")[0].split(":")[0] } : {}),
        })
        .eq("id", numero.id);
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
        .in("autor", ["robo", "humano"])
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
  const anuncio = anuncioDaMensagem(d);
  if (linha && anuncio && linha.meta_ad_id !== anuncio.id) {
    // último clique vale: o contato voltou por outro anúncio
    await db.from("contatos").update({ meta_ad_id: anuncio.id, ctwa_clid: anuncio.ctwa, origem: anuncio.origem }).eq("id", linha.id);
  }
  if (!linha) {
    const { data: novo } = await db
      .from("contatos")
      .insert({ dono_id: donoId, telefone, nome: d.pushName ?? null, numero_id: numero.id, ...(anuncio ? { meta_ad_id: anuncio.id, ctwa_clid: anuncio.ctwa, origem: anuncio.origem } : {}) })
      .select(CAMPOS_CONTATO)
      .single();
    linha = novo;
    await M.evento(ctx, linhaParaContato(linha), "novo_contato");
  }
  const contato = linhaParaContato(linha);
  await db.from("mensagens").insert({ dono_id: donoId, contato_id: contato.id, autor: "cliente", tipo: "texto", conteudo: texto, wa_id: d.key?.id });
  await db.from("contatos").update({ ultima_msg_em: new Date().toISOString(), numero_id: numero.id }).eq("id", contato.id);

  // disparos: marca que respondeu e trata o pedido de SAIR
  const tresDias = new Date(Date.now() - 3 * 86_400_000).toISOString();
  await db.from("campanha_envios").update({ respondeu_em: new Date().toISOString() }).eq("contato_id", contato.id).eq("status", "enviado").is("respondeu_em", null).gte("enviado_em", tresDias);
  if (ehPedidoSair(texto)) {
    const { count } = await db
      .from("campanha_envios")
      .select("id", { count: "exact", head: true })
      .eq("contato_id", contato.id)
      .eq("status", "enviado")
      .gte("enviado_em", new Date(Date.now() - 7 * 86_400_000).toISOString());
    if (count) {
      if (!contato.etiquetas.includes(ETIQUETA_SAIR)) await db.from("contatos").update({ etiquetas: [...contato.etiquetas, ETIQUETA_SAIR] }).eq("id", contato.id);
      try {
        const confirma = "Tudo bem! Você não vai mais receber nossas mensagens. 👍";
        await criarEnvioEvolution(db, cfg).enviar(contato, { tipo: "texto", texto: confirma, esperaMs: 1500 });
        await db.from("mensagens").insert({ dono_id: donoId, contato_id: contato.id, autor: "robo", tipo: "texto", conteudo: confirma });
      } catch (e) {
        console.error("falha ao confirmar SAIR", e);
      }
      return json({ ok: true, sair: true });
    }
  }

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
      if (a.tipo === "pix_pago") {
        await M.pixPago(ctx, contato, String(a.dados?.pagamento_id ?? ""));
      } else if (a.tipo === "reprocessar") {
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
  let disparos = 0;
  try {
    disparos = await processarDisparos(db, cfg);
  } catch (e) {
    console.error("erro nos disparos", e);
  }
  let pagos = 0;
  try {
    pagos = await conferirPendentes(cfg);
  } catch (e) {
    console.error("erro ao conferir Pix", e);
  }
  return json({ ok: true, feitos, disparos, pagos });
}

/* ------------------------------------------------------------------ */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const rota = new URL(req.url).pathname.replace(/^.*\/motor/, "") || "/";
  try {
    if (rota === "/saude") return json({ ok: true, motor: "xclozr", hora: new Date().toISOString() });
    if (rota === "/simular" && req.method === "POST") return await simular(req);
    if (rota === "/numeros" && req.method === "POST") return await numeros(req);
    if (rota === "/enviar" && req.method === "POST") return await enviarManual(req);
    if (rota === "/ia" && req.method === "POST") return await rotaIA(req);
    if (rota === "/gateway" && req.method === "POST") return await gateway(req);
    const cfg = await configMotor(db);
    if (rota === "/evolution" && req.method === "POST") return await evolution(req, cfg);
    if (rota === "/relogio" && req.method === "POST") return await relogio(req, cfg);
    if (rota === "/pagbank" && req.method === "POST") return await avisoPagBank(req, cfg);
    return json({ erro: "rota não encontrada" }, 404);
  } catch (e) {
    console.error(e);
    return json({ erro: "falha interna" }, 500);
  }
});
