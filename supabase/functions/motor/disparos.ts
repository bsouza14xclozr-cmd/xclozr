// Disparos (remarketing): envia a fila de cada campanha com ritmo humano, janela de horário e limite por chip.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { criarEnvioEvolution } from "./envio.ts";
import { normalizar, preencher, type Saida } from "./motor.ts";
import { CAMPOS_CONTATO, linhaParaContato } from "./store.ts";

export const ETIQUETA_SAIR = "Não perturbe";
const PALAVRAS_SAIR = new Set(["sair", "parar", "pare", "stop", "cancelar", "descadastrar", "nao quero mais", "remover"]);

/** {oi|olá|e aí} → escolhe uma opção, para cada mensagem sair um pouco diferente */
export function spintax(t: string) {
  let s = t;
  for (let i = 0; i < 20 && /\{[^{}]*\|[^{}]*\}/.test(s); i++) {
    s = s.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, g: string) => {
      const ops = g.split("|");
      return ops[Math.floor(Math.random() * ops.length)];
    });
  }
  return s;
}

function horaBrasilia(d: Date) {
  return new Date(d.getTime() - 3 * 3600_000).getUTCHours();
}

/** Próximo horário de abertura da janela (em Brasília). */
function proximaAbertura(agora: Date, horaInicio: number) {
  const b = new Date(agora.getTime() - 3 * 3600_000);
  let alvo = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), horaInicio + 3, Math.floor(Math.random() * 10));
  if (alvo <= agora.getTime()) alvo += 86_400_000;
  return new Date(alvo);
}

function inicioDoDiaBrasilia(agora: Date) {
  const b = new Date(agora.getTime() - 3 * 3600_000);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), 3));
}

export function ehPedidoSair(texto: string) {
  return PALAVRAS_SAIR.has(normalizar(texto).replace(/[^\p{L}\s]/gu, "").trim());
}

export async function processarDisparos(db: SupabaseClient, cfg: Record<string, string>) {
  const agora = new Date();
  const { data: camps } = await db
    .from("campanhas")
    .select("*")
    .eq("status", "enviando")
    .lte("proximo_envio_em", agora.toISOString())
    .order("proximo_envio_em")
    .limit(10);

  let feitos = 0;
  for (const cp of camps ?? []) {
    const minS = Math.max(10, cp.intervalo_min_seg);
    const maxS = Math.max(minS, cp.intervalo_max_seg);
    const espera = (minS + Math.random() * (maxS - minS)) * 1000;
    // trava: só um relógio processa esta campanha neste ciclo
    const { data: pegou } = await db
      .from("campanhas")
      .update({ proximo_envio_em: new Date(agora.getTime() + espera).toISOString() })
      .eq("id", cp.id)
      .eq("status", "enviando")
      .lte("proximo_envio_em", agora.toISOString())
      .select("id");
    if (!pegou?.length) continue;

    const adiar = (quando: Date) => db.from("campanhas").update({ proximo_envio_em: quando.toISOString() }).eq("id", cp.id);

    const h = horaBrasilia(agora);
    const dentro = cp.janela_inicio < cp.janela_fim ? h >= cp.janela_inicio && h < cp.janela_fim : h >= cp.janela_inicio || h < cp.janela_fim;
    if (!dentro) {
      await adiar(proximaAbertura(agora, cp.janela_inicio));
      continue;
    }

    const { data: env } = await db
      .from("campanha_envios")
      .select("id, contato_id")
      .eq("campanha_id", cp.id)
      .eq("status", "pendente")
      .order("ordem")
      .limit(1)
      .maybeSingle();
    if (!env) {
      await db.from("campanhas").update({ status: "concluida", concluido_em: agora.toISOString(), proximo_envio_em: null }).eq("id", cp.id);
      continue;
    }

    const ignorar = async (erro: string) => {
      await db.from("campanha_envios").update({ status: "ignorado", erro }).eq("id", env.id);
      await adiar(new Date(agora.getTime() + 3000)); // pula rápido para o próximo
    };

    const { data: linha } = await db.from("contatos").select(CAMPOS_CONTATO).eq("id", env.contato_id).maybeSingle();
    if (!linha) {
      await ignorar("contato apagado");
      continue;
    }
    const c = linhaParaContato(linha);
    if (c.etiquetas.includes(ETIQUETA_SAIR)) {
      await ignorar("pediu para não receber");
      continue;
    }
    const { data: num } = await db.from("numeros").select("id, status").eq("id", c.numero_id ?? "").maybeSingle();
    if (!num || num.status !== "conectado") {
      await ignorar("chip desconectado");
      continue;
    }

    const { count } = await db
      .from("campanha_envios")
      .select("id", { count: "exact", head: true })
      .eq("numero_id", num.id)
      .eq("status", "enviado")
      .gte("enviado_em", inicioDoDiaBrasilia(agora).toISOString());
    if ((count ?? 0) >= cp.limite_diario_chip) {
      await adiar(new Date(agora.getTime() + 30 * 60_000));
      continue;
    }

    try {
      const envio = criarEnvioEvolution(db, cfg);
      const rodape = cp.incluir_sair ? "\n\n_Se não quiser mais receber, responda SAIR._" : "";
      const texto = (preencher(spintax(cp.mensagem ?? ""), c).trim() + rodape).trim();
      const saidas: Saida[] = [];
      if (cp.midia_url && (cp.midia_tipo === "imagem" || cp.midia_tipo === "video")) {
        saidas.push({ tipo: cp.midia_tipo, url: cp.midia_url, legenda: texto, esperaMs: 2500 });
      } else {
        if (cp.midia_url && cp.midia_tipo === "audio") saidas.push({ tipo: "audio", url: cp.midia_url, esperaMs: 3000 });
        if (cp.midia_url && cp.midia_tipo === "arquivo") saidas.push({ tipo: "arquivo", url: cp.midia_url, nome: "arquivo", esperaMs: 2000 });
        if (texto) saidas.push({ tipo: "texto", texto, esperaMs: 2500 });
      }
      for (const s of saidas) {
        await envio.enviar(c, s);
        await db.from("mensagens").insert({
          dono_id: c.dono_id,
          contato_id: c.id,
          autor: "robo",
          tipo: s.tipo,
          conteudo: s.tipo === "texto" ? s.texto : "legenda" in s ? s.legenda : null,
          midia_url: "url" in s ? s.url : null,
        });
      }
      await db.from("campanha_envios").update({ status: "enviado", numero_id: num.id, enviado_em: new Date().toISOString() }).eq("id", env.id);
      await db.from("campanhas").update({ enviados: (cp.enviados ?? 0) + 1 }).eq("id", cp.id);
      const patch: Record<string, unknown> = { ultima_msg_em: new Date().toISOString() };
      if (cp.funil_id) {
        // quando o cliente responder, o funil escolhido começa do zero
        Object.assign(patch, { funil_id: cp.funil_id, bloco_atual: null, finalizado: false, aguardando: null, pix_ativo: null, robo_ativo: true });
        await db.from("agendamentos").update({ feito: true }).eq("contato_id", c.id).eq("feito", false);
      }
      await db.from("contatos").update(patch).eq("id", c.id);
      feitos++;
    } catch (e) {
      await db.from("campanha_envios").update({ status: "falhou", erro: String((e as Error).message).slice(0, 300) }).eq("id", env.id);
      await db.from("campanhas").update({ falhas: (cp.falhas ?? 0) + 1 }).eq("id", cp.id);
    }
  }
  return feitos;
}
