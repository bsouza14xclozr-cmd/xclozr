import type { Edge } from "@xyflow/react";
import { blocoDe, type Acao, type ItemMensagem, type Objecao, type Regra } from "./blocos";
import type { NoBloco } from "./grafo";

export type Problema = {
  blocoId: string;
  /** grave = trava a conversa (o robô para ali); aviso = funciona, mas provavelmente não é o que você quer */
  nivel: "grave" | "aviso";
  texto: string;
};

const vazio = (v: unknown) => typeof v !== "string" || v.trim() === "";

/** Confere o funil e lista o que está faltando, bloco a bloco. */
export function validarFunil(nodes: NoBloco[], edges: Edge[], produtos: { id: string }[], funis: { id: string }[]): Problema[] {
  const p: Problema[] = [];
  const add = (blocoId: string, nivel: Problema["nivel"], texto: string) => p.push({ blocoId, nivel, texto });
  const idsProdutos = new Set(produtos.map((x) => x.id));
  const idsFunis = new Set(funis.map((x) => x.id));
  const saiDe = (id: string, saida: string) => edges.some((e) => e.source === id && (e.sourceHandle ?? "seguir") === saida);

  // alcançáveis a partir do Início
  const inicio = nodes.find((n) => n.data.tipo === "inicio");
  const alcancados = new Set<string>();
  if (inicio) {
    const fila = [inicio.id];
    while (fila.length) {
      const id = fila.shift()!;
      if (alcancados.has(id)) continue;
      alcancados.add(id);
      for (const e of edges) if (e.source === id) fila.push(e.target);
    }
  }

  if (inicio && !edges.some((e) => e.source === inicio.id)) add(inicio.id, "grave", "O Início não está ligado a nenhum bloco: o robô não responde nada.");

  for (const n of nodes) {
    const c = n.data.config ?? {};
    const nome = blocoDe(n.data.tipo).nome;
    // bloco solto nunca roda: só avisa e não cobra o resto
    if (n.data.tipo !== "inicio" && inicio && !alcancados.has(n.id)) {
      add(n.id, "aviso", `${nome}: bloco solto, nenhuma seta chega nele (ele nunca roda).`);
      continue;
    }

    switch (n.data.tipo) {
      case "mensagem": {
        const itens = (c.itens ?? []) as ItemMensagem[];
        const conteudo = itens.filter((i) => i.tipo !== "espera");
        if (!conteudo.length) add(n.id, "aviso", "Mensagem sem conteúdo.");
        for (const i of conteudo) {
          if (i.tipo === "texto" && vazio(i.texto)) add(n.id, "aviso", "Mensagem com um texto em branco.");
          if (i.tipo !== "texto" && vazio(i.url)) add(n.id, "grave", `Mensagem com ${i.tipo === "audio" ? "áudio" : i.tipo === "video" ? "vídeo" : i.tipo} sem arquivo enviado.`);
        }
        break;
      }
      case "pergunta":
        if (vazio(c.texto)) add(n.id, "grave", "Pergunta sem o texto da pergunta.");
        if (!saiDe(n.id, "respondeu")) add(n.id, "aviso", "Pergunta: a saída “Respondeu” não leva a lugar nenhum.");
        break;
      case "menu": {
        const opcoes = (c.opcoes ?? []) as string[];
        if (opcoes.filter((o) => !vazio(o)).length < 2) add(n.id, "grave", "Menu precisa de pelo menos 2 opções.");
        opcoes.forEach((o, i) => !vazio(o) && !saiDe(n.id, `opcao_${i}`) && add(n.id, "aviso", `Menu: a opção “${o}” não leva a lugar nenhum.`));
        break;
      }
      case "objecoes": {
        if (vazio(c.palavrasCompra)) add(n.id, "grave", "Objeções: faltam as palavras de quem quer comprar (ex.: quero, pix, sim).");
        const objs = (c.objecoes ?? []) as Objecao[];
        if (objs.some((o) => !vazio(o.palavras) && vazio(o.resposta))) add(n.id, "aviso", "Objeções: tem objeção sem resposta.");
        if (!saiDe(n.id, "comprar")) add(n.id, "grave", "Objeções: a saída “Quer comprar” não está ligada (normalmente vai para o Pix).");
        break;
      }
      case "pix":
        if (vazio(c.produtoId)) add(n.id, "grave", "Pix sem produto escolhido: o robô para aqui e não manda o Pix.");
        else if (!idsProdutos.has(String(c.produtoId))) add(n.id, "grave", "Pix com um produto que foi apagado ou pausado.");
        if (!saiDe(n.id, "pagou")) add(n.id, "aviso", "Pix: depois de pagar não acontece nada (ligue a saída “Pagou” na Entrega).");
        if (!saiDe(n.id, "nao_pagou")) add(n.id, "aviso", "Pix: sem lembrete para quem não pagou (saída “Não pagou ainda”).");
        break;
      case "entregar":
        if (vazio(c.produtoId) && vazio(c.texto)) add(n.id, "grave", "Entrega sem produto e sem mensagem: o cliente não recebe nada.");
        else if (!vazio(c.produtoId) && !idsProdutos.has(String(c.produtoId))) add(n.id, "grave", "Entrega com um produto que foi apagado ou pausado.");
        break;
      case "upsell":
        if (vazio(c.texto)) add(n.id, "grave", "Upsell sem a mensagem da oferta.");
        if (vazio(c.palavrasSim)) add(n.id, "aviso", "Upsell sem palavras de aceite: toda resposta vira “recusou”.");
        if (!saiDe(n.id, "aceitou")) add(n.id, "aviso", "Upsell: a saída “Aceitou” não está ligada (normalmente vai para um Pix).");
        break;
      case "condicao": {
        const regras = (c.regras ?? []) as Regra[];
        if (!regras.length) add(n.id, "aviso", "Condição sem regras: sempre segue pelo “Sim”.");
        if (regras.some((r) => vazio(r.valor) && !["ja_comprou", "pix_pendente"].includes(r.tipo))) add(n.id, "aviso", "Condição com regra incompleta.");
        break;
      }
      case "acao": {
        const acoes = (c.acoes ?? []) as Acao[];
        if (!acoes.length) add(n.id, "aviso", "Ação sem nenhuma ação configurada.");
        if (acoes.some((a) => ["etiqueta_add", "etiqueta_remover", "campo_definir", "campo_limpar", "kanban_mover"].includes(a.tipo) && vazio(a.valor)))
          add(n.id, "aviso", "Ação incompleta (etiqueta, campo ou coluna em branco).");
        break;
      }
      case "randomizador":
        if (((c.opcoes ?? []) as string[]).length < 2) add(n.id, "aviso", "Randomizador precisa de pelo menos 2 caminhos.");
        break;
      case "ir_funil":
        if (vazio(c.funilId)) add(n.id, "grave", "Ir para funil sem funil escolhido.");
        else if (!idsFunis.has(String(c.funilId))) add(n.id, "grave", "Ir para funil aponta para um funil que não existe mais.");
        break;
      case "integracao":
        if (!String(c.url ?? "").startsWith("https://")) add(n.id, "grave", "Integração precisa de uma URL começando com https://");
        break;
      case "ia":
        if (vazio(c.instrucoes) && vazio(c.conhecimento)) add(n.id, "grave", "Agente IA sem instruções nem informações do produto: a IA não sabe o que vender.");
        if (!saiDe(n.id, "concluiu")) add(n.id, "aviso", "Agente IA: a saída “Objetivo concluído” não está ligada (normalmente vai para o Pix).");
        if (!saiDe(n.id, "limite")) add(n.id, "aviso", "Agente IA: a saída “Limite atingido” não está ligada (ex.: chamar humano).");
        break;
    }
  }
  return p;
}
