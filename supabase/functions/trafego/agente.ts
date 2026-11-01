// Agente de tráfego com IA: analisa as campanhas, escreve um relatório e recomenda (ou aplica) ações
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { configIA, extrairJson, perguntarIA } from "./ia.ts";
import type { Nivel } from "./meta.ts";
import { aplicarComTravas, diaBR, lerCfg, relatorioDe, type Linha } from "./regras.ts";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const NIVEIS: Nivel[] = ["campanha", "conjunto", "anuncio"];

type Rec = { nivel: Nivel; id: string; acao: "pausar" | "ativar" | "aumentar" | "diminuir"; valor_pct?: number; motivo?: string };
type RespostaAgente = { resumo?: string; recomendacoes?: Rec[]; revisao_regras?: string };

function tabela(ls: Linha[], ontem: Map<string, Linha>) {
  return ls
    .map((l) => {
      const o = ontem.get(l.id);
      const roas = l.gasto ? (l.faturamento / l.gasto).toFixed(2) : "-";
      const cpa = l.vendas ? brl(Math.round(l.gasto / l.vendas)) : "-";
      return [
        l.id,
        l.nome.slice(0, 60),
        l.status,
        l.orcamento_diario ? `${brl(l.orcamento_diario)}/dia` : "-",
        `7d: gasto ${brl(l.gasto)}, contatos ${l.contatos}, conversas ${l.conversas_meta}, pix ${l.pix_gerados}, vendas ${l.vendas}, fat ${brl(l.faturamento)}, lucro ${brl(l.lucro)}, ROAS ${roas}, CPA ${cpa}`,
        o ? `ontem: gasto ${brl(o.gasto)}, contatos ${o.contatos}, vendas ${o.vendas}, lucro ${brl(o.lucro)}` : "ontem: sem gasto",
      ].join(" | ");
    })
    .join("\n");
}

export async function rodarAgente(db: SupabaseClient, donoId: string, manual = false) {
  const cfg = await lerCfg(db, donoId);
  const modo = cfg.agente_modo === "desligado" ? (manual ? "recomendar" : null) : cfg.agente_modo;
  if (!modo) return { erro: "agente desligado" };
  const ia = await configIA(db, donoId);
  if (!ia) return { erro: "Ligue uma IA no menu Agente de IA para o agente de tráfego funcionar." };

  // dados: últimos 7 dias e ontem, por nível
  const blocos: string[] = [];
  const existentes = new Map<string, { nivel: Nivel; linha: Linha }>();
  let gastoTotal = 0;
  for (const nivel of NIVEIS) {
    const sete = (await relatorioDe(db, donoId, nivel, diaBR(-6), diaBR(0))).filter((l) => l.gasto > 0 || l.vendas > 0 || l.status === "ACTIVE").slice(0, 25);
    const ontem = new Map((await relatorioDe(db, donoId, nivel, diaBR(-1), diaBR(-1))).map((l) => [l.id, l]));
    for (const l of sete) existentes.set(`${nivel}:${l.id}`, { nivel, linha: l });
    if (nivel === "campanha") gastoTotal = sete.reduce((a, l) => a + l.gasto, 0);
    blocos.push(`### ${nivel.toUpperCase()}S (id | nome | status | orçamento | números)\n${sete.length ? tabela(sete, ontem) : "(nenhum)"}`);
  }
  if (gastoTotal === 0) return { erro: "Ainda não há gasto nos últimos 7 dias para analisar. Conecte o Meta e espere os dados chegarem." };

  // economia do produto
  const { data: conf } = await db.from("configuracoes").select("taxa_percentual, taxa_fixa_centavos, imposto_venda_pct, imposto_meta_pct").eq("dono_id", donoId).maybeSingle();
  const { data: produtos } = await db.from("produtos").select("nome, preco_centavos, custo_centavos").eq("dono_id", donoId).eq("ativo", true).limit(10);
  const tp = Number(conf?.taxa_percentual ?? 0);
  const tf = Number(conf?.taxa_fixa_centavos ?? 0);
  const iv = Number(conf?.imposto_venda_pct ?? 0);
  const im = Number(conf?.imposto_meta_pct ?? 0);
  const economia = (produtos ?? [])
    .map((p) => {
      const lucro = p.preco_centavos - (p.preco_centavos * tp) / 100 - tf - (p.custo_centavos ?? 0) - (p.preco_centavos * iv) / 100;
      return `- ${p.nome}: preço ${brl(p.preco_centavos)}, lucro por venda antes do anúncio ≈ ${brl(Math.round(lucro))}, CPA máximo de empate ≈ ${brl(Math.round(lucro / (1 + im / 100)))}`;
    })
    .join("\n");

  const { data: regras } = await db.from("meta_regras").select("nome, ativa, nivel, acao, valor, condicoes, periodo").eq("dono_id", donoId);
  const { data: acoes } = await db
    .from("meta_acoes")
    .select("nome, acao, de, para, origem, criado_em")
    .eq("dono_id", donoId)
    .eq("ok", true)
    .gte("criado_em", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order("criado_em", { ascending: false })
    .limit(20);

  const sistema = [
    "Você é um gestor de tráfego sênior especialista em produtos low ticket vendidos no X1 (anúncio do Meta que leva para o WhatsApp, onde um robô vende e gera o Pix).",
    "Analise os números e responda em português do Brasil, direto ao ponto, como um gestor experiente falaria com o dono.",
    "Princípios: não mate anúncio com pouco gasto; precisa de pelo menos 3 vendas para escalar; aumento de orçamento de no máximo " +
      `${cfg.aumento_max_pct}% por vez; não mexa em nada que gastou menos de ${brl(cfg.gasto_min_centavos)}; ` +
      "no X1, custo por conversa alto e poucos contatos indicam criativo fraco; muitos contatos e poucos Pix indicam problema no funil/oferta, não no anúncio; " +
      "use o lucro (já desconta gasto, taxas, impostos e custo do produto) como principal medida.",
    'Responda SOMENTE com JSON: {"resumo": "texto com tópicos começando com • (máx. 180 palavras): situação geral, o que está dando lucro, o que está queimando dinheiro, criativos cansando, problemas no funil", ' +
      '"recomendacoes": [{"nivel": "campanha|conjunto|anuncio", "id": "id exato da tabela", "acao": "pausar|ativar|aumentar|diminuir", "valor_pct": número só para aumentar/diminuir, "motivo": "frase curta com os números"}], ' +
      '"revisao_regras": "1-3 frases dizendo se as regras automáticas parecem apertadas, frouxas ou ok, e o que mudar"}.',
    "No máximo 8 recomendações, só com boa justificativa nos números. Mudança de orçamento só em campanha/conjunto que tem orçamento diário. Use apenas ids que aparecem nas tabelas. Pode recomendar nada se estiver tudo bem.",
  ].join("\n");

  const usuario = [
    `Hoje é ${diaBR(0)}. Gasto total dos últimos 7 dias: ${brl(gastoTotal)}.`,
    `\n## Economia dos produtos\n${economia || "(sem produtos cadastrados)"}`,
    `\n## Travas\nteto diário total: ${cfg.teto_diario_centavos ? brl(cfg.teto_diario_centavos) : "sem teto"}; aumento máximo: ${cfg.aumento_max_pct}%; gasto mínimo para mexer: ${brl(cfg.gasto_min_centavos)}`,
    `\n## Regras automáticas atuais\n${(regras ?? []).map((r) => `- ${r.ativa ? "" : "(desligada) "}${r.nome}: ${r.nivel}, ${r.acao}${r.valor ? ` ${r.valor}` : ""}, período ${r.periodo}, condições ${JSON.stringify(r.condicoes)}`).join("\n") || "(nenhuma)"}`,
    `\n## Ações dos últimos 7 dias\n${(acoes ?? []).map((a) => `- ${a.criado_em.slice(0, 16)} ${a.nome}: ${a.acao} ${a.de}→${a.para} (${a.origem})`).join("\n") || "(nenhuma)"}`,
    `\n## Dados\n${blocos.join("\n\n")}`,
  ].join("\n");

  let resposta: RespostaAgente | null;
  try {
    const r = await perguntarIA(ia, sistema, usuario, 3000);
    resposta = extrairJson<RespostaAgente>(r.texto);
    await db.from("ia_uso").insert({ dono_id: donoId, provedor: ia.provedor, modelo: ia.modelo, tokens_entrada: r.entrada, tokens_saida: r.saida });
  } catch (e) {
    return { erro: `A IA falhou: ${(e as Error).message}`.slice(0, 300) };
  }
  if (!resposta?.resumo) return { erro: "A IA não devolveu um relatório válido. Tente de novo." };

  const { data: rel } = await db
    .from("agente_relatorios")
    .insert({ dono_id: donoId, modo, texto: String(resposta.resumo).slice(0, 4000), revisao_regras: resposta.revisao_regras ? String(resposta.revisao_regras).slice(0, 1000) : null })
    .select("id")
    .single();
  if (!rel) return { erro: "Não consegui salvar o relatório." };

  let aplicadas = 0;
  let sugeridas = 0;
  for (const rec of (resposta.recomendacoes ?? []).slice(0, 8)) {
    const alvo = existentes.get(`${rec.nivel}:${rec.id}`);
    if (!alvo || !["pausar", "ativar", "aumentar", "diminuir"].includes(rec.acao)) continue;
    const valor = rec.acao === "aumentar" || rec.acao === "diminuir" ? Math.round(Number(rec.valor_pct) || 20) : null;
    const { data: sug } = await db
      .from("agente_sugestoes")
      .insert({ relatorio_id: rel.id, dono_id: donoId, nivel: rec.nivel, objeto_id: rec.id, nome: alvo.linha.nome, acao: rec.acao, valor, motivo: String(rec.motivo ?? "").slice(0, 400) })
      .select("id")
      .single();
    sugeridas++;
    if (modo === "automatico" && sug) {
      const res = await aplicarComTravas(db, donoId, cfg, rec.nivel, alvo.linha, rec.acao, valor, "regra", { motivo: `agente IA: ${String(rec.motivo ?? "").slice(0, 200)}` });
      await db.from("agente_sugestoes").update({ status: res.ok ? "aplicada" : res.bloqueado ? "bloqueada" : "falhou", resultado: res.texto }).eq("id", sug.id);
      if (res.ok) aplicadas++;
    }
  }

  await db.from("trafego_config").upsert({ dono_id: donoId, agente_ultimo: diaBR(0) });
  await db.from("avisos").insert({
    dono_id: donoId,
    tipo: "trafego",
    link: "/anuncios?aba=agente",
    texto:
      modo === "automatico"
        ? `Agente de tráfego: relatório pronto, ${aplicadas} ação(ões) aplicada(s) de ${sugeridas} recomendada(s).`
        : `Agente de tráfego: relatório pronto com ${sugeridas} recomendação(ões) esperando sua aprovação.`,
  });
  return { ok: true, relatorio_id: rel.id, sugeridas, aplicadas };
}

/** Aplica (ou ignora) uma sugestão pendente, com as travas. */
export async function aplicarSugestao(db: SupabaseClient, donoId: string, sugestaoId: string) {
  const { data: s } = await db.from("agente_sugestoes").select("*").eq("id", sugestaoId).eq("dono_id", donoId).maybeSingle();
  if (!s) return { erro: "Sugestão não encontrada." };
  if (s.status !== "pendente") return { erro: "Essa sugestão já foi resolvida." };
  const cfg = await lerCfg(db, donoId);
  const linhas = await relatorioDe(db, donoId, s.nivel, diaBR(-6), diaBR(0));
  const l = linhas.find((x) => x.id === s.objeto_id);
  if (!l) return { erro: "O item não existe mais no Meta." };
  const res = await aplicarComTravas(db, donoId, { ...cfg, gasto_min_centavos: 0 }, s.nivel, l, s.acao, s.valor === null ? null : Number(s.valor), "painel", { motivo: `agente IA (aprovado): ${s.motivo ?? ""}`.slice(0, 250) });
  await db.from("agente_sugestoes").update({ status: res.ok ? "aplicada" : res.bloqueado ? "bloqueada" : "falhou", resultado: res.texto }).eq("id", s.id);
  return res.ok ? { ok: true, texto: res.texto } : { erro: res.texto };
}
