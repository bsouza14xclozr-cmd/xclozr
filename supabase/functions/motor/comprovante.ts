// Conferência de comprovante (só para quem recebeu a CHAVE Pix pelo app; copia e cola segue automático pelo gateway):
// a IA lê o comprovante e o XClozr confere no Asaas se um Pix com o mesmo valor, dia e nome do pagador entrou de verdade.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as M from "./motor.ts";
import { lerComprovante, type LeituraComprovante } from "./ia.ts";
import { configGateway, nomeClienteAsaas, pixRecebidosAsaas } from "./gateway.ts";

export const MARCA_CHAVE = "__chave_pix"; // campo do contato: quando a chave Pix foi enviada pelo app
const VALIDADE_MARCA_MS = 3 * 86_400_000;
const MAX_TENTATIVAS = 6; // ~18 min conferindo

const VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "d"]);
function tokens(n: string) {
  return M.normalizar(n)
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !VAZIAS.has(t));
}

/** "Ítala Marcia de Assis Ribeiro" × "ITALA M A RIBEIRO" → bate (mesmo primeiro nome + mais um sobrenome). */
export function nomesBatem(a: string | null | undefined, b: string | null | undefined) {
  const x = tokens(a ?? "");
  const y = tokens(b ?? "");
  if (!x.length || !y.length) return false;
  if (x[0] !== y[0]) return false;
  if (x.length === 1 || y.length === 1) return x.length === y.length; // só primeiro nome dos dois lados
  return x.slice(1).some((t) => y.slice(1).includes(t));
}

/** A conversa está marcada como "mandei a chave Pix" (e a marca ainda vale)? */
export function chaveEnviada(c: M.Contato) {
  const em = c.campos?.[MARCA_CHAVE];
  return Boolean(em && Date.now() - new Date(em).getTime() < VALIDADE_MARCA_MS);
}

/** Mensagem que você mandou pelo celular parece ser a chave Pix (mensagem de Pix do WhatsApp Business ou chave escrita). */
export function pareceChavePix(mensagem: unknown, texto: string) {
  const bruto = JSON.stringify(mensagem ?? {});
  if (/payment_info|pix_key|"pixKey"|paymentInvite|merchant_name/i.test(bruto)) return true;
  if (!/\bpix\b/i.test(texto)) return false;
  return (
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(texto) || // aleatória
    /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(texto) || // CPF
    /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/.test(texto) || // CNPJ
    /[\w.+-]+@[\w-]+\.[\w.]+/.test(texto) || // e-mail
    /\(?\d{2}\)?\s?9?\d{4}-?\d{4}/.test(texto) // celular
  );
}

type Deps = {
  db: SupabaseClient;
  evolution: { url: string; apikey: string };
  ctx: (donoId: string, c: M.Contato) => M.Ctx;
  agendar: (c: M.Contato, executarEm: Date, dados: Record<string, unknown>) => Promise<void>;
};

async function falar(ctx: M.Ctx, c: M.Contato, texto: string) {
  const s: M.Saida = { tipo: "texto", texto, esperaMs: 1500 };
  await ctx.envio.enviar(c, s);
  await ctx.store.registrarMensagemRobo(c, s);
}

async function baixarMidia(d: Deps, instancia: string, waId: string) {
  const r = await fetch(`${d.evolution.url.replace(/\/+$/, "")}/chat/getBase64FromMediaMessage/${encodeURIComponent(instancia)}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: d.evolution.apikey },
    body: JSON.stringify({ message: { key: { id: waId } }, convertToMp4: false }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`Evolution ${r.status}`);
  const j = await r.json();
  if (!j?.base64) throw new Error("mídia sem conteúdo");
  return { base64: String(j.base64), mime: String(j.mimetype || "image/jpeg").split(";")[0] };
}

function diaBR(desloc = 0, base?: string | null) {
  const t = base && /^\d{4}-\d{2}-\d{2}/.test(base) ? new Date(`${base.slice(0, 10)}T12:00:00-03:00`).getTime() : Date.now() - 3 * 3600_000;
  return new Date(t + desloc * 86_400_000).toISOString().slice(0, 10);
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Chamado pelo relógio (agendamento "comprovante"). dados: { wa_id, tentativa, leitura? }
 */
export async function conferirComprovante(d: Deps, donoId: string, c: M.Contato & { numero_id?: string | null }, dados: Record<string, any>) {
  const ctx = d.ctx(donoId, c);
  const tentativa = Number(dados.tentativa ?? 0);
  const gw = await configGateway(d.db, donoId);
  if (!gw || gw.gateway !== "asaas") {
    await ctx.store.avisarDono(c, "Chegou um comprovante, mas a conferência automática só funciona com o Asaas. Confira e entregue pelo 📦 no Conversas.");
    return;
  }

  // 1. a IA lê o comprovante (uma vez; nas novas tentativas usa a leitura guardada)
  let leitura = dados.leitura as LeituraComprovante | undefined;
  if (!leitura) {
    const { data: num } = await d.db.from("numeros").select("instancia").eq("id", c.numero_id ?? "").maybeSingle();
    if (!num) return;
    let midia;
    try {
      midia = await baixarMidia(d, num.instancia, String(dados.wa_id));
    } catch (e) {
      ctx.log?.(`comprovante: não baixei a mídia (${(e as Error).message})`);
      return;
    }
    const r = await lerComprovante(d.db, donoId, c.id, midia.base64, midia.mime);
    if ("erro" in r) {
      await ctx.store.avisarDono(c, `Chegou um comprovante e a IA não conseguiu ler (${r.erro}). Confira e entregue pelo 📦 no Conversas.`);
      return;
    }
    leitura = r;
  }
  if (!leitura.e_comprovante_pix || !leitura.valor_centavos) return; // foto qualquer: segue a conversa normal

  // 2. procura no Asaas um Pix recebido pela chave (sem QR Code) com o mesmo valor, perto da data e com o mesmo nome
  const recebidos = await pixRecebidosAsaas(gw, diaBR(-1, leitura.data_hora), diaBR(1, leitura.data_hora));
  const candidatos = recebidos.filter((p) => !p.pixQrCodeId && Math.round(Number(p.value) * 100) === leitura!.valor_centavos);
  let achado: (typeof candidatos)[number] | null = null;
  if (candidatos.length) {
    const { data: usados } = await d.db.from("pagamentos").select("gateway_id").eq("gateway", "asaas").in("gateway_id", candidatos.map((p) => p.id));
    const jaUsados = new Set((usados ?? []).map((u: { gateway_id: string }) => u.gateway_id));
    for (const p of candidatos.filter((x) => !jaUsados.has(x.id))) {
      const nome = await nomeClienteAsaas(gw, p.customer).catch(() => "");
      if (nomesBatem(nome, leitura.pagador_nome)) {
        achado = p;
        break;
      }
    }
  }

  if (!achado) {
    if (tentativa === 0) await falar(ctx, c, "Recebi seu comprovante! 🙏 Só um instante que já confiro o pagamento por aqui.");
    if (tentativa + 1 < MAX_TENTATIVAS) {
      await d.agendar(c, new Date(Date.now() + 3 * 60_000), { wa_id: dados.wa_id, tentativa: tentativa + 1, leitura });
      return;
    }
    await falar(ctx, c, "Ainda não consegui confirmar seu Pix por aqui 🙏 Já avisei a equipe e em instantes te respondem, tá?");
    await ctx.store.avisarDono(
      c,
      `Comprovante não confirmado no Asaas: ${brl(leitura.valor_centavos)} de ${leitura.pagador_nome ?? "nome não lido"}${leitura.data_hora ? ` em ${leitura.data_hora}` : ""}${leitura.suspeito ? " (a IA achou o comprovante suspeito)" : ""}. Confira e, se estiver certo, entregue pelo 📦 no Conversas.`,
    );
    return;
  }

  // 3. confirmado: registra o pagamento e segue o funil pela saída "Pagou" (entrega, agradecimento, upsell)
  await registrarPago(d, ctx, donoId, c, achado.id, leitura.valor_centavos);
}

async function registrarPago(d: Deps, ctx: M.Ctx, donoId: string, c: M.Contato, asaasId: string, valor: number) {
  const campos = { ...c.campos };
  delete campos[MARCA_CHAVE];
  // o robô volta a atender esta conversa (você tinha assumido ao mandar a chave)
  await d.db.from("contatos").update({ campos, robo_ativo: true, robo_retomar_em: null }).eq("id", c.id);
  Object.assign(c, { campos, robo_ativo: true });

  // a) já tinha um Pix do funil aberto com esse valor: usa ele
  if (c.pix_ativo) {
    const { data: pg } = await d.db.from("pagamentos").select("id, valor_centavos").eq("id", c.pix_ativo.pagamento_id).maybeSingle();
    if (pg && Math.abs(pg.valor_centavos - valor) <= 1) {
      await d.db.from("pagamentos").update({ gateway: "asaas", gateway_id: asaasId }).eq("id", pg.id);
      await d.db.from("pagamentos").update({ status: "pago", pago_em: new Date().toISOString() }).eq("id", pg.id).eq("status", "pendente");
      await M.pixPago(ctx, c, pg.id);
      return;
    }
  }

  // b) sem Pix aberto: acha no funil o bloco de Pix do produto com esse preço e segue dele
  const funilId = c.funil_id;
  const funil = funilId ? await ctx.store.funil(funilId) : null;
  const { data: produtos } = await d.db.from("produtos").select("id, preco_centavos").eq("dono_id", donoId).eq("ativo", true);
  const doPreco = (produtos ?? []).filter((p: { preco_centavos: number }) => Math.abs(p.preco_centavos - valor) <= 1).map((p: { id: string }) => p.id);
  const blocoPix = funil?.grafo.nodes.find((n) => n.data.tipo === "pix" && doPreco.includes(String(n.data.config?.produtoId ?? "")));
  const produtoId = blocoPix ? String(blocoPix.data.config?.produtoId) : doPreco[0] ?? null;

  const { data: novo } = await d.db
    .from("pagamentos")
    .insert({ dono_id: donoId, contato_id: c.id, produto_id: produtoId, tipo: "principal", valor_centavos: valor, taxa_centavos: 0, status: "pendente", gateway: "asaas", gateway_id: asaasId, simulacao: false })
    .select("id")
    .single();
  if (!novo) return;
  await d.db.from("pagamentos").update({ status: "pago", pago_em: new Date().toISOString() }).eq("id", novo.id);

  if (blocoPix && funil) {
    const pixAtivo: M.PixAtivo = { bloco: blocoPix.id, pagamento_id: novo.id, funil_id: funil.id, tipo: "principal" };
    await d.db.from("contatos").update({ pix_ativo: pixAtivo }).eq("id", c.id);
    c.pix_ativo = pixAtivo;
    await M.pixPago(ctx, c, novo.id);
    return;
  }

  // c) não achou o produto no funil: entrega o produto do preço (se houver) e avisa você
  const { data: p } = produtoId
    ? await d.db.from("produtos").select("nome, entrega_tipo, entrega_conteudo, mensagem_entrega").eq("id", produtoId).maybeSingle()
    : { data: null };
  if (p?.entrega_conteudo) {
    await falar(ctx, c, M.preencher(p.mensagem_entrega || "Pagamento confirmado! 🙏 Aqui está o seu {produto} 👇", c, { produto: p.nome }));
    const s: M.Saida = p.entrega_tipo === "arquivo" ? { tipo: "arquivo", url: p.entrega_conteudo, nome: p.nome, esperaMs: 1500 } : { tipo: "texto", texto: p.entrega_conteudo, esperaMs: 1200 };
    await ctx.envio.enviar(c, s);
    await ctx.store.registrarMensagemRobo(c, s);
  } else {
    await falar(ctx, c, "Pagamento confirmado! Muito obrigado 🙏");
  }
  await ctx.store.avisarDono(c, `Pix de ${brl(valor)} confirmado pelo comprovante, mas não achei o produto desse valor no funil. Confira se a entrega está certa.`);
}
