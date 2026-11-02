// Liga o cérebro ao banco Supabase (com a chave de serviço, sempre filtrando pelo dono)
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { configGateway, criarPixPagBank } from "./gateway.ts";
import type { Contato, Evento, Funil, PatchContato, Produto, Saida, Store } from "./motor.ts";

export const CAMPOS_CONTATO =
  "id, dono_id, telefone, nome, funil_id, bloco_atual, aguardando, pix_ativo, finalizado, ja_respondeu, robo_ativo, campos, etiquetas, kanban_coluna_id, simulacao, numero_id, meta_ad_id, anuncio:anuncios(codigo_rastreio)";

export function linhaParaContato(l: any): Contato & { numero_id: string | null } {
  const an = Array.isArray(l.anuncio) ? l.anuncio[0] : l.anuncio;
  return {
    id: l.id,
    dono_id: l.dono_id,
    telefone: l.telefone,
    nome: l.nome,
    funil_id: l.funil_id,
    bloco_atual: l.bloco_atual,
    aguardando: l.aguardando,
    pix_ativo: l.pix_ativo,
    finalizado: l.finalizado,
    ja_respondeu: l.ja_respondeu,
    robo_ativo: l.robo_ativo,
    campos: l.campos ?? {},
    etiquetas: l.etiquetas ?? [],
    kanban_coluna_id: l.kanban_coluna_id,
    anuncio_codigo: an?.codigo_rastreio ?? null,
    simulacao: l.simulacao,
    numero_id: l.numero_id ?? null,
  };
}

export function criarStore(db: SupabaseClient, donoId: string): Store {
  const cacheFunis = new Map<string, Funil | null>();
  const cacheColunas = new Map<string, string | null>();

  return {
    agora: () => new Date(),

    async funil(id) {
      if (cacheFunis.has(id)) return cacheFunis.get(id)!;
      const { data } = await db.from("funis").select("id, grafo").eq("id", id).eq("dono_id", donoId).maybeSingle();
      const f = data ? ({ id: data.id, grafo: data.grafo } as Funil) : null;
      cacheFunis.set(id, f);
      return f;
    },

    async produto(id) {
      const { data } = await db
        .from("produtos")
        .select("id, nome, preco_centavos, entrega_tipo, entrega_conteudo, mensagem_entrega")
        .eq("id", id)
        .eq("dono_id", donoId)
        .maybeSingle();
      return (data as Produto) ?? null;
    },

    async colunaDoEvento(_dono, ev: Evento) {
      if (cacheColunas.has(ev)) return cacheColunas.get(ev)!;
      const { data } = await db.from("kanban_colunas").select("id").eq("dono_id", donoId).eq("evento", ev).maybeSingle();
      cacheColunas.set(ev, data?.id ?? null);
      return data?.id ?? null;
    },

    async atualizarContato(c: Contato, patch: PatchContato) {
      const { anuncio_codigo: _a, ...resto } = patch as PatchContato & { anuncio_codigo?: unknown };
      if (Object.keys(resto).length) await db.from("contatos").update(resto).eq("id", c.id).eq("dono_id", donoId);
    },

    async agendar(c, tipo, executarEm, dados) {
      await db.from("agendamentos").insert({ dono_id: donoId, contato_id: c.id, tipo, executar_em: executarEm.toISOString(), dados });
    },

    async cancelarAgendamentos(c, tipos) {
      let q = db.from("agendamentos").update({ feito: true }).eq("contato_id", c.id).eq("feito", false);
      if (tipos?.length) q = q.in("tipo", tipos);
      await q;
    },

    async registrarExecucao(c, funilId, blocoId, saida) {
      if (c.simulacao) return; // simulador não entra nas métricas
      await db.from("execucoes_bloco").insert({ dono_id: donoId, funil_id: funilId, bloco_id: blocoId, contato_id: c.id, saida });
    },

    async registrarMensagemRobo(c, s: Saida) {
      const conteudo = s.tipo === "texto" ? s.texto : "legenda" in s ? s.legenda : s.tipo === "arquivo" ? s.nome : null;
      await db.from("mensagens").insert({
        dono_id: donoId,
        contato_id: c.id,
        autor: "robo",
        tipo: s.tipo,
        conteudo,
        midia_url: "url" in s ? s.url : null,
      });
      await db.from("contatos").update({ ultima_msg_em: new Date().toISOString() }).eq("id", c.id);
    },

    async criarPix(c, produto, expiraMin, tipo) {
      const { data: cfg } = await db.from("configuracoes").select("taxa_percentual, taxa_fixa_centavos").eq("dono_id", donoId).maybeSingle();
      const taxa = cfg ? Math.round((produto.preco_centavos * Number(cfg.taxa_percentual)) / 100) + (cfg.taxa_fixa_centavos ?? 0) : 0;

      const gw = c.simulacao ? null : await configGateway(db, donoId);
      if (!c.simulacao && !gw) throw new Error("nenhum gateway conectado (Produtos → Gateway de Pix)");
      const { data: anuncio } = await db.from("contatos").select("anuncio_id").eq("id", c.id).maybeSingle();
      const { data, error } = await db
        .from("pagamentos")
        .insert({
          dono_id: donoId,
          contato_id: c.id,
          produto_id: produto.id,
          anuncio_id: anuncio?.anuncio_id ?? null,
          tipo,
          valor_centavos: produto.preco_centavos,
          taxa_centavos: taxa,
          status: "pendente",
          gateway: c.simulacao ? "simulacao" : gw!.gateway,
          simulacao: c.simulacao,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error("falha ao criar pagamento");
      if (c.simulacao) {
        const copiaCola = `00020126SIMULACAO-XCLOZR-${data.id.slice(0, 8)}5204000053039865802BR (Pix de teste, não pague)`;
        await db.from("pagamentos").update({ pix_copia_cola: copiaCola }).eq("id", data.id);
        return { id: data.id, copiaCola };
      }
      try {
        const pix = await criarPixPagBank(gw!, donoId, {
          referencia: data.id,
          descricao: produto.nome,
          valorCentavos: produto.preco_centavos,
          expiraMin,
          nome: c.nome,
          telefone: c.telefone,
        });
        await db
          .from("pagamentos")
          .update({ pix_copia_cola: pix.copiaCola, gateway_id: pix.pedidoId, verificar_em: new Date(Date.now() + 60_000).toISOString() })
          .eq("id", data.id);
        return { id: data.id, copiaCola: pix.copiaCola };
      } catch (e) {
        await db.from("pagamentos").delete().eq("id", data.id);
        await db.from("gateway_config").update({ erro: String((e as Error).message).slice(0, 300) }).eq("dono_id", donoId);
        throw e;
      }
    },

    async pagamentoPendente(c) {
      const { count } = await db.from("pagamentos").select("id", { count: "exact", head: true }).eq("contato_id", c.id).eq("status", "pendente");
      return (count ?? 0) > 0;
    },

    async jaComprou(c) {
      const { count } = await db.from("pagamentos").select("id", { count: "exact", head: true }).eq("contato_id", c.id).eq("status", "pago");
      return (count ?? 0) > 0;
    },

    async marcarPixExpirado(id) {
      await db.from("pagamentos").update({ status: "expirado" }).eq("id", id).eq("status", "pendente");
    },

    async avisarDono(c, texto) {
      await db.from("avisos").insert({ dono_id: donoId, contato_id: c.id, texto });
    },
  };
}
