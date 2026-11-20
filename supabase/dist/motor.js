// supabase/functions/motor/index.ts
import { createClient } from "@supabase/supabase-js";

// supabase/functions/motor/motor.ts
var MAX_PASSOS = 60;
function normalizar(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function palavras(lista) {
  return (lista ?? "").split(",").map((p) => normalizar(p)).filter(Boolean);
}
function contemAlguma(texto, lista) {
  const t = ` ${normalizar(texto).replace(/[^\p{L}\p{N}\s]/gu, " ")} `;
  return lista.some((p) => t.includes(` ${p} `) || p.includes(" ") && t.includes(p));
}
function negou(texto) {
  const t = ` ${normalizar(texto).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ")} `;
  return / (nao|naum|naon|nao quero|n|nem|nunca|jamais|dispenso|sem interesse) /.test(t);
}
function brl(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function primeiroNome(n) {
  return (n ?? "").trim().split(/\s+/)[0] ?? "";
}
function preencher(texto, c, extra = {}) {
  const vars = {
    ...c.campos,
    nome: primeiroNome(c.nome) || primeiroNome(c.campos.nome ?? null) || "",
    nome_completo: c.nome ?? c.campos.nome ?? "",
    telefone: c.telefone,
    ...extra
  };
  return (texto ?? "").replace(/\{([a-z0-9_]+)\}/gi, (m, k) => k.toLowerCase() in vars ? vars[k.toLowerCase()] : m).replace(/ {2,}/g, " ");
}
function token() {
  return Math.random().toString(36).slice(2, 10);
}
function minutos(n, padrao) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : padrao;
}
function addMin(d, min) {
  return new Date(d.getTime() + min * 6e4);
}
function no(f, id) {
  return f.grafo.nodes.find((n) => n.id === id) ?? null;
}
function proximo(f, blocoId, saida) {
  const e = f.grafo.edges.find((x) => x.source === blocoId && (x.sourceHandle ?? "seguir") === saida);
  return e?.target ?? null;
}
async function evento(ctx, c, ev) {
  const coluna = await ctx.store.colunaDoEvento(c.dono_id, ev);
  if (coluna && coluna !== c.kanban_coluna_id) await patch(ctx, c, { kanban_coluna_id: coluna });
}
async function patch(ctx, c, p) {
  Object.assign(c, p);
  await ctx.store.atualizarContato(c, p);
}
async function enviar(ctx, c, s) {
  await ctx.envio.enviar(c, s);
  await ctx.store.registrarMensagemRobo(c, s);
}
async function enviarTexto(ctx, c, texto, esperaMs = 1500) {
  const t = preencher(texto, c).trim();
  if (t) await enviar(ctx, c, { tipo: "texto", texto: t, esperaMs });
}
async function enviarRespostaIA(ctx, c, texto, dividir) {
  const partes = dividir ? texto.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).slice(0, 4) : [texto.trim()];
  for (const p of partes) await enviar(ctx, c, { tipo: "texto", texto: p, esperaMs: Math.min(6e3, 900 + p.length * 35) });
}
async function iniciar(ctx, c, funil) {
  await ctx.store.cancelarAgendamentos(c);
  await patch(ctx, c, { funil_id: funil.id, aguardando: null, bloco_atual: null, finalizado: false });
  const inicio = funil.grafo.nodes.find((n) => n.data.tipo === "inicio");
  const primeiro = inicio ? proximo(funil, inicio.id, "seguir") : null;
  if (inicio) await ctx.store.registrarExecucao(c, funil.id, inicio.id, "seguir");
  if (!primeiro) {
    await patch(ctx, c, { finalizado: true });
    return;
  }
  await executarDesde(ctx, c, funil, primeiro, "");
}
async function executarDesde(ctx, c, funilInicial, blocoId, ultimaMensagem) {
  let funil = funilInicial;
  let atual = blocoId;
  for (let passo = 0; atual && passo < MAX_PASSOS; passo++) {
    const n = no(funil, atual);
    if (!n) break;
    await patch(ctx, c, { bloco_atual: n.id, aguardando: null });
    const r = await executarBloco(ctx, c, funil, n, ultimaMensagem);
    if ("espera" in r) {
      await patch(ctx, c, { aguardando: r.espera });
      return;
    }
    if ("parar" in r) {
      if (r.finalizar) await patch(ctx, c, { finalizado: true, aguardando: null });
      return;
    }
    await ctx.store.registrarExecucao(c, funil.id, n.id, r.saida);
    if (r.saida === "__trocar_funil__") {
      const novo = await ctx.store.funil(String(n.data.config.funilId ?? ""));
      if (!novo) break;
      funil = novo;
      await patch(ctx, c, { funil_id: novo.id });
      const ini = novo.grafo.nodes.find((x) => x.data.tipo === "inicio");
      atual = ini ? proximo(novo, ini.id, "seguir") : null;
      continue;
    }
    atual = proximo(funil, n.id, r.saida);
  }
  await patch(ctx, c, { finalizado: true, aguardando: null });
}
async function esperarResposta(ctx, c, n, tipo, esperarMin, extra = {}) {
  const t = token();
  await ctx.store.cancelarAgendamentos(c, ["timeout", "esperar"]);
  await ctx.store.agendar(c, tipo === "esperar" ? "esperar" : "timeout", addMin(ctx.store.agora(), esperarMin), { bloco: n.id, token: t });
  return { espera: { bloco: n.id, tipo, token: t, tentativas: 0, ...extra } };
}
async function executarBloco(ctx, c, funil, n, ultimaMensagem) {
  const cfg = n.data.config ?? {};
  ctx.log?.(`bloco ${n.data.tipo} (${n.id})`);
  switch (n.data.tipo) {
    case "inicio":
      return { saida: "seguir" };
    case "mensagem": {
      let espera = 1200;
      for (const item of cfg.itens ?? []) {
        if (item.tipo === "espera") {
          espera = Math.max(0, Number(item.segundos) || 0) * 1e3;
          continue;
        }
        if (item.tipo === "texto") {
          const t = preencher(item.texto ?? "", c).trim();
          if (t) await enviar(ctx, c, { tipo: "texto", texto: t, esperaMs: espera });
        } else if ((item.tipo === "imagem" || item.tipo === "video") && item.url) {
          await enviar(ctx, c, { tipo: item.tipo, url: item.url, legenda: preencher(item.legenda ?? "", c), esperaMs: espera });
        } else if (item.tipo === "audio" && item.url) {
          await enviar(ctx, c, { tipo: "audio", url: item.url, esperaMs: espera });
        } else if (item.tipo === "arquivo" && item.url) {
          await enviar(ctx, c, { tipo: "arquivo", url: item.url, nome: item.nome || "arquivo", esperaMs: espera });
        }
        espera = 1200;
      }
      return { saida: "seguir" };
    }
    case "pergunta":
      await enviarTexto(ctx, c, cfg.texto ?? "");
      return esperarResposta(ctx, c, n, "pergunta", minutos(cfg.esperarMin, 60));
    case "menu": {
      const opcoes = cfg.opcoes ?? [];
      const linhas = opcoes.map((o, i) => `*${i + 1}.* ${o}`).join("\n");
      await enviarTexto(ctx, c, [cfg.texto ?? "", linhas].filter(Boolean).join("\n\n"));
      return esperarResposta(ctx, c, n, "menu", minutos(cfg.esperarMin, 60));
    }
    case "objecoes":
      return esperarResposta(ctx, c, n, "objecoes", minutos(cfg.esperarMin, 120));
    case "upsell":
      await enviarTexto(ctx, c, cfg.texto ?? "");
      return esperarResposta(ctx, c, n, "upsell", minutos(cfg.esperarMin, 30));
    case "esperar": {
      const mult = { segundos: 1 / 60, minutos: 1, horas: 60, dias: 1440 };
      const min = (Number(cfg.quantidade) || 1) * (mult[cfg.unidade] ?? 1);
      return esperarResposta(ctx, c, n, "esperar", min, { cancelaSeResponder: Boolean(cfg.cancelaSeResponder) });
    }
    case "condicao": {
      const regras = cfg.regras ?? [];
      if (!regras.length) return { saida: "sim" };
      const resultados = await Promise.all(regras.map((r) => avaliarRegra(ctx, c, r, ultimaMensagem)));
      const ok = cfg.logica === "qualquer" ? resultados.some(Boolean) : resultados.every(Boolean);
      return { saida: ok ? "sim" : "nao" };
    }
    case "acao": {
      for (const a of cfg.acoes ?? []) {
        const valor = preencher(String(a.valor ?? ""), c).trim();
        switch (a.tipo) {
          case "etiqueta_add":
            if (valor && !c.etiquetas.includes(valor)) await patch(ctx, c, { etiquetas: [...c.etiquetas, valor] });
            break;
          case "etiqueta_remover":
            if (valor) await patch(ctx, c, { etiquetas: c.etiquetas.filter((e) => e !== valor) });
            break;
          case "campo_definir":
            if (valor) await patch(ctx, c, { campos: { ...c.campos, [valor]: preencher(String(a.valor2 ?? ""), c) } });
            break;
          case "campo_limpar":
            if (valor) {
              const campos = { ...c.campos };
              delete campos[valor];
              await patch(ctx, c, { campos });
            }
            break;
          case "kanban_mover":
            if (a.valor) await patch(ctx, c, { kanban_coluna_id: String(a.valor) });
            break;
          case "pausar_robo":
            await patch(ctx, c, { robo_ativo: false });
            break;
          case "notificar":
            await ctx.store.avisarDono(c, valor || `Aviso do funil sobre ${c.nome ?? c.telefone}`);
            break;
          case "encerrar":
            await ctx.store.registrarExecucao(c, funil.id, n.id, "encerrar");
            return { parar: true, finalizar: true };
        }
      }
      return { saida: "seguir" };
    }
    case "randomizador": {
      const opcoes = cfg.opcoes ?? [];
      if (!opcoes.length) return { saida: "seguir" };
      const brutos = opcoes.map((_, i) => Math.max(0, Number((cfg.pesos ?? [])[i]) || 0));
      const pesos = brutos.some((p) => p > 0) ? brutos : opcoes.map(() => 1);
      let sorteio = Math.random() * pesos.reduce((a, b) => a + b, 0);
      for (let i = 0; i < opcoes.length; i++) {
        sorteio -= pesos[i];
        if (sorteio < 0) return { saida: `caminho_${i}` };
      }
      return { saida: `caminho_${opcoes.length - 1}` };
    }
    case "ir_funil":
      return cfg.funilId ? { saida: "__trocar_funil__" } : { parar: true, finalizar: true };
    case "humano":
      await enviarTexto(ctx, c, cfg.texto ?? "");
      await patch(ctx, c, { robo_ativo: false });
      await ctx.store.avisarDono(c, preencher(cfg.aviso || "Cliente {nome} ({telefone}) pediu atendimento humano.", c));
      await evento(ctx, c, "humano");
      await ctx.store.registrarExecucao(c, funil.id, n.id, null);
      return { parar: true, finalizar: true };
    case "pix": {
      const produto = cfg.produtoId ? await ctx.store.produto(String(cfg.produtoId)) : null;
      if (!produto) {
        ctx.log?.("bloco Pix sem produto");
        await ctx.store.avisarDono(c, "O funil chegou num bloco Pix sem produto escolhido e parou. Abra o funil e selecione o produto no bloco Pix.");
        return { parar: true, finalizar: true };
      }
      const anterior = no(funil, funil.grafo.edges.find((e) => e.target === n.id)?.source ?? "");
      const tipoPix = anterior?.data.tipo === "upsell" ? "upsell" : "principal";
      const expira = minutos(cfg.expiraMin, 1440);
      let pix;
      try {
        pix = await ctx.store.criarPix(c, produto, expira, tipoPix);
      } catch (e) {
        ctx.log?.(`falha ao gerar Pix: ${e.message}`);
        await enviarTexto(ctx, c, "Só um instante, já te mando o Pix 🙏");
        await patch(ctx, c, { robo_ativo: false });
        await ctx.store.avisarDono(
          c,
          `Não consegui gerar o Pix de ${brl(produto.preco_centavos)} para {nome} ({telefone}): ${e.message}. O robô pausou nessa conversa — mande o Pix manualmente em Conversas.`.replace("{nome}", c.nome ?? "o cliente").replace("{telefone}", c.telefone)
        );
        return { parar: true, finalizar: true };
      }
      await enviarTexto(ctx, c, preencher(cfg.texto || "Aqui está o seu Pix de {preco} 👇", c, { produto: produto.nome, preco: brl(produto.preco_centavos) }));
      if (pix.link) {
        await enviar(ctx, c, { tipo: "texto", texto: `👉 Toque no link para abrir o Pix (o código *copia e cola* e o QR Code estão lá):
${pix.link}`, esperaMs: 800 });
      } else {
        await enviar(ctx, c, { tipo: "texto", texto: pix.copiaCola, esperaMs: 800 });
      }
      await patch(ctx, c, { pix_ativo: { bloco: n.id, pagamento_id: pix.id, funil_id: funil.id, tipo: tipoPix } });
      await ctx.store.cancelarAgendamentos(c, ["pix_nao_pagou", "pix_expirou"]);
      await ctx.store.agendar(c, "pix_nao_pagou", addMin(ctx.store.agora(), minutos(cfg.esperarMin, 15)), { bloco: n.id, pagamento_id: pix.id });
      await ctx.store.agendar(c, "pix_expirou", addMin(ctx.store.agora(), expira), { bloco: n.id, pagamento_id: pix.id });
      if (tipoPix === "principal") await evento(ctx, c, "pix_gerado");
      await ctx.store.registrarExecucao(c, funil.id, n.id, null);
      return { parar: true };
    }
    case "entregar": {
      const produto = cfg.produtoId ? await ctx.store.produto(String(cfg.produtoId)) : null;
      const texto = cfg.texto || produto?.mensagem_entrega || "Pagamento confirmado! ✅";
      await enviarTexto(ctx, c, preencher(texto, c, produto ? { produto: produto.nome, preco: brl(produto.preco_centavos) } : {}));
      if (produto?.entrega_conteudo) {
        if (produto.entrega_tipo === "arquivo") {
          await enviar(ctx, c, { tipo: "arquivo", url: produto.entrega_conteudo, nome: produto.nome, esperaMs: 1e3 });
        } else {
          await enviar(ctx, c, { tipo: "texto", texto: produto.entrega_conteudo, esperaMs: 1e3 });
        }
      }
      return { saida: "seguir" };
    }
    case "integracao": {
      try {
        const headers = cfg.headers ? JSON.parse(preencher(cfg.headers, c)) : {};
        const corpo = cfg.corpo ? preencher(cfg.corpo, c) : void 0;
        const metodo = String(cfg.metodo || "POST").toUpperCase();
        if (!String(cfg.url || "").startsWith("https://")) return { saida: "erro" };
        const r = await fetch(preencher(cfg.url, c), {
          method: metodo,
          headers: { "content-type": "application/json", ...headers },
          body: metodo === "GET" ? void 0 : corpo
        });
        const txt = (await r.text()).slice(0, 2e3);
        if (cfg.salvarEm) await patch(ctx, c, { campos: { ...c.campos, [cfg.salvarEm]: txt } });
        return { saida: r.ok ? "sucesso" : "erro" };
      } catch {
        return { saida: "erro" };
      }
    }
    case "ia": {
      if (!ctx.ia) return { saida: "limite" };
      const r = await ctx.ia(c, cfg);
      if ("erro" in r) {
        await ctx.store.avisarDono(c, `${r.erro} O funil seguiu pela saída “Limite”.`);
        return { saida: "limite" };
      }
      await enviarRespostaIA(ctx, c, r.resposta, Boolean(cfg.dividir));
      if (r.concluido) return { saida: "concluiu" };
      if (minutos(cfg.maxRespostas, 10) <= 1) return { saida: "limite" };
      await ctx.store.cancelarAgendamentos(c, ["timeout", "esperar"]);
      return { espera: { bloco: n.id, tipo: "ia", token: token(), tentativas: 1 } };
    }
    default:
      return { saida: "seguir" };
  }
}
async function avaliarRegra(ctx, c, r, ultimaMensagem) {
  const valor = String(r.valor ?? "");
  switch (r.tipo) {
    case "mensagem": {
      const lista = palavras(valor);
      const msg = normalizar(ultimaMensagem);
      if (r.operador === "igual") return lista.includes(msg);
      if (r.operador === "diferente") return !lista.includes(msg);
      if (r.operador === "nao_contem") return !contemAlguma(ultimaMensagem, lista);
      return contemAlguma(ultimaMensagem, lista);
    }
    case "etiqueta": {
      const tem = c.etiquetas.some((e) => normalizar(e) === normalizar(valor));
      return r.operador === "nao_tem" ? !tem : tem;
    }
    case "campo": {
      const v = c.campos[valor];
      if (r.operador === "preenchido") return Boolean(v && String(v).trim());
      if (r.operador === "vazio") return !v || !String(v).trim();
      if (r.operador === "contem") return normalizar(String(v ?? "")).includes(normalizar(String(r.valor2 ?? "")));
      return normalizar(String(v ?? "")) === normalizar(String(r.valor2 ?? ""));
    }
    case "horario": {
      const agora = horaBrasilia(ctx.store.agora());
      const ini = paraMin(valor);
      const fim = paraMin(String(r.valor2 ?? ""));
      if (ini === null || fim === null) return false;
      const dentro = ini <= fim ? agora >= ini && agora < fim : agora >= ini || agora < fim;
      return r.operador === "fora" ? !dentro : dentro;
    }
    case "dia_semana": {
      const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
      const hoje = dias[diaBrasilia(ctx.store.agora())];
      const lista = palavras(valor).map((d) => d.slice(0, 3));
      const e = lista.includes(hoje);
      return r.operador === "nao_e" ? !e : e;
    }
    case "ja_comprou": {
      const sim = await ctx.store.jaComprou(c);
      return r.operador === "nao" ? !sim : sim;
    }
    case "pix_pendente": {
      const sim = await ctx.store.pagamentoPendente(c);
      return r.operador === "nao" ? !sim : sim;
    }
    case "anuncio": {
      const e = normalizar(c.anuncio_codigo ?? "") === normalizar(valor);
      return r.operador === "nao_e" ? !e : e;
    }
    default:
      return false;
  }
}
function paraMin(hhmm) {
  const m = hhmm.match(/^(\d{1,2}):?(\d{2})?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2] ?? 0);
}
function horaBrasilia(d) {
  const b = new Date(d.getTime() - 3 * 36e5);
  return b.getUTCHours() * 60 + b.getUTCMinutes();
}
function diaBrasilia(d) {
  return new Date(d.getTime() - 3 * 36e5).getUTCDay();
}
async function receberMensagem(ctx, c, funilPadrao, texto) {
  if (!c.ja_respondeu && (c.bloco_atual || c.finalizado)) {
    await patch(ctx, c, { ja_respondeu: true });
    await evento(ctx, c, "respondeu");
  }
  if (!c.robo_ativo) return;
  if (!c.funil_id || !c.bloco_atual && !c.finalizado) {
    const f = c.funil_id && await ctx.store.funil(c.funil_id) || await funilPadrao();
    if (f) await iniciar(ctx, c, f);
    return;
  }
  if (c.finalizado && !c.aguardando && !c.pix_ativo) {
    const atual = await ctx.store.funil(c.funil_id);
    if (!atual || atual.ativo === false || !await ctx.store.jaComprou(c)) {
      const f = await funilPadrao();
      if (f) await iniciar(ctx, c, f);
      return;
    }
  }
  const funil = await ctx.store.funil(c.funil_id);
  if (!funil) return;
  const ag = c.aguardando;
  if (!ag) return;
  const n = no(funil, ag.bloco);
  if (!n) return;
  const cfg = n.data.config ?? {};
  const seguir = async (saida) => {
    await ctx.store.cancelarAgendamentos(c, ["timeout", "esperar"]);
    await ctx.store.registrarExecucao(c, funil.id, n.id, saida);
    await patch(ctx, c, { aguardando: null });
    await executarDesde(ctx, c, funil, proximo(funil, n.id, saida), texto);
  };
  const repetir = async (msg) => {
    await enviarTexto(ctx, c, msg);
    await patch(ctx, c, { aguardando: { ...ag, tentativas: ag.tentativas + 1 } });
  };
  switch (ag.tipo) {
    case "pergunta": {
      const tipo = cfg.tipoResposta ?? "texto";
      const t = texto.trim();
      const valido = tipo === "qualquer" || tipo === "numero" && /\d/.test(t) || tipo === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) || tipo === "texto" && t.length > 0;
      if (valido) {
        if (cfg.salvarEm) {
          const chave = String(cfg.salvarEm);
          const extra = { campos: { ...c.campos, [chave]: t } };
          if (chave === "nome") extra.nome = t;
          await patch(ctx, c, extra);
        }
        return seguir("respondeu");
      }
      if (ag.tentativas + 1 >= minutos(cfg.tentativas, 2)) return seguir("invalida");
      return repetir(cfg.msgInvalida || "Não entendi, pode responder de novo?");
    }
    case "menu": {
      const opcoes = cfg.opcoes ?? [];
      const num = texto.match(/\d+/);
      let i = num ? Number(num[0]) - 1 : -1;
      if (!(i >= 0 && i < opcoes.length)) i = opcoes.findIndex((o) => normalizar(texto).includes(normalizar(o)) && normalizar(o).length > 0);
      if (i >= 0) return seguir(`opcao_${i}`);
      return repetir(cfg.msgInvalida || "Responda só com o número da opção 🙂");
    }
    case "objecoes": {
      if (!negou(texto) && contemAlguma(texto, palavras(cfg.palavrasCompra))) return seguir("comprar");
      const obj = (cfg.objecoes ?? []).find((o) => contemAlguma(texto, palavras(o.palavras)));
      if (obj?.resposta) return repetir(obj.resposta);
      if (cfg.naoEntendeu) return repetir(cfg.naoEntendeu);
      return;
    }
    case "upsell": {
      if (!negou(texto) && contemAlguma(texto, palavras(cfg.palavrasSim))) return seguir("aceitou");
      return seguir("recusou");
    }
    case "esperar":
      if (ag.cancelaSeResponder) return seguir("seguir");
      return;
    case "ia": {
      if (!ctx.ia) return seguir("limite");
      const r = await ctx.ia(c, cfg);
      if ("erro" in r) {
        await ctx.store.avisarDono(c, `${r.erro} O funil seguiu pela saída “Limite”.`);
        return seguir("limite");
      }
      await enviarRespostaIA(ctx, c, r.resposta, Boolean(cfg.dividir));
      if (r.concluido) return seguir("concluiu");
      if (ag.tentativas + 1 >= minutos(cfg.maxRespostas, 10)) return seguir("limite");
      await patch(ctx, c, { aguardando: { ...ag, tentativas: ag.tentativas + 1 } });
      return;
    }
  }
}
async function executarAgendamento(ctx, c, tipo, dados) {
  if (!c.funil_id && !dados.funil_id) return;
  if (tipo === "pix_nao_pagou" || tipo === "pix_expirou") {
    if (!c.pix_ativo || c.pix_ativo.pagamento_id !== dados.pagamento_id) return;
    const funil2 = await ctx.store.funil(c.pix_ativo.funil_id);
    if (!funil2) return;
    if (tipo === "pix_expirou") {
      await ctx.store.marcarPixExpirado(dados.pagamento_id);
      await ctx.store.cancelarAgendamentos(c);
      await patch(ctx, c, { pix_ativo: null });
      await evento(ctx, c, "pix_expirou");
    }
    if (!c.robo_ativo) return;
    const saida2 = tipo === "pix_expirou" ? "expirou" : "nao_pagou";
    await ctx.store.registrarExecucao(c, funil2.id, dados.bloco, saida2);
    await executarDesde(ctx, c, funil2, proximo(funil2, dados.bloco, saida2), "");
    return;
  }
  const ag = c.aguardando;
  if (!ag || ag.bloco !== dados.bloco || ag.token !== dados.token || !c.funil_id) return;
  const funil = await ctx.store.funil(c.funil_id);
  if (!funil || !c.robo_ativo) return;
  const saida = tipo === "esperar" ? "seguir" : "sem_resposta";
  await ctx.store.registrarExecucao(c, funil.id, ag.bloco, saida);
  await patch(ctx, c, { aguardando: null });
  await executarDesde(ctx, c, funil, proximo(funil, ag.bloco, saida), "");
}
async function pixPago(ctx, c, pagamentoId) {
  const ativo = c.pix_ativo;
  await evento(ctx, c, ativo?.pagamento_id === pagamentoId && ativo.tipo === "upsell" ? "upsell_aceito" : "pagou");
  if (!ativo || ativo.pagamento_id !== pagamentoId) return;
  await ctx.store.cancelarAgendamentos(c);
  await patch(ctx, c, { pix_ativo: null, aguardando: null, finalizado: false });
  const funil = await ctx.store.funil(ativo.funil_id);
  if (!funil) return;
  await patch(ctx, c, { funil_id: funil.id });
  await ctx.store.registrarExecucao(c, funil.id, ativo.bloco, "pagou");
  await executarDesde(ctx, c, funil, proximo(funil, ativo.bloco, "pagou"), "");
}

// supabase/functions/motor/gateway.ts
var BASE = { producao: "https://api.pagseguro.com", sandbox: "https://sandbox.api.pagseguro.com" };
async function configGateway(db2, donoId) {
  const { data } = await db2.from("gateway_config").select("gateway, token, ambiente, segredo_webhook, acesso_token, acesso_expira, chave_pix").eq("dono_id", donoId).maybeSingle();
  return data ?? null;
}
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
  const base2 = {
    reference_id: p.referencia,
    items: [{ reference_id: p.referencia.slice(0, 64), name: (p.descricao || "Produto").slice(0, 64), quantity: 1, unit_amount: p.valorCentavos }],
    qr_codes: [{ amount: { value: p.valorCentavos }, expiration_date: expira.toISOString().replace(/\.\d{3}Z$/, "Z") }],
    notification_urls: [urlAviso(donoId, cfg.segredo_webhook)]
  };
  const cliente = { name: (p.nome || "Cliente").replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 60) || "Cliente", phones: p.telefone ? telefoneBR(p.telefone) : void 0 };
  let r;
  try {
    r = await chamar(cfg, "POST", "/orders", { ...base2, customer: cliente });
  } catch (e) {
    if (!/customer/i.test(`${e.message} ${e.parametros ?? ""}`)) throw e;
    r = await chamar(cfg, "POST", "/orders", base2);
  }
  const qr = r.qr_codes?.[0];
  if (!qr?.text || !r.id) throw new Error("o PagBank não devolveu o código Pix (confira se sua conta tem uma chave Pix cadastrada)");
  return { pedidoId: r.id, copiaCola: qr.text, qrPng: qr.links?.find((l) => l.rel === "QRCODE.PNG")?.href ?? null };
}
async function pedidoPago(cfg, pedidoId) {
  const r = await chamar(cfg, "GET", `/orders/${encodeURIComponent(pedidoId)}`);
  return { pago: (r.charges ?? []).some((c) => c.status === "PAID"), referencia: r.reference_id ?? null };
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
    const token2 = await tokenLivePix(db2, donoId, cfg, tentativa > 0);
    const r = await fetch(`${LP_API}${caminho}`, {
      method: metodo,
      headers: { authorization: `Bearer ${token2}`, "content-type": "application/json", accept: "application/json" },
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
async function cobrancaLivePixPaga(db2, cfg, donoId, referencia, valorCentavos) {
  const r = await livePix(db2, donoId, cfg, "GET", `/v2/payments?reference=${encodeURIComponent(referencia)}&limit=10`);
  const lista = Array.isArray(r.data) ? r.data : r.data ? [r.data] : [];
  return lista.some((x) => x.reference === referencia && (x.currency ?? "BRL") === "BRL" && Number(x.amount ?? 0) >= valorCentavos);
}
async function pagamentoLivePix(db2, cfg, donoId, id) {
  const r = await livePix(db2, donoId, cfg, "GET", `/v2/payments/${encodeURIComponent(id)}`);
  return r.data ?? null;
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
async function pixAsaasPago(cfg, qrId, valorCentavos) {
  const r = await asaas(cfg, "GET", `/payments?pixQrCodeId=${encodeURIComponent(qrId)}&limit=10`);
  return (r.data ?? []).some((c) => ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(String(c.status)) && Math.round(Number(c.value ?? 0) * 100) >= valorCentavos);
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
      const token2 = String(corpo.token ?? "").trim();
      const ambiente = corpo.ambiente === "sandbox" ? "sandbox" : "producao";
      if (token2.length < 20) return { erro: "Cole a chave de API do Asaas." };
      cfg = { gateway: "asaas", token: token2, ambiente, segredo_webhook: segredo };
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
      const token2 = String(corpo.token ?? "").trim();
      const ambiente = corpo.ambiente === "sandbox" ? "sandbox" : "producao";
      if (token2.length < 20) return { erro: "Cole o token do PagBank." };
      cfg = { gateway: "pagbank", token: token2, ambiente, segredo_webhook: segredo };
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

// supabase/functions/motor/store.ts
var CAMPOS_CONTATO = "id, dono_id, telefone, nome, funil_id, bloco_atual, aguardando, pix_ativo, finalizado, ja_respondeu, robo_ativo, campos, etiquetas, kanban_coluna_id, simulacao, numero_id, meta_ad_id, anuncio:anuncios(codigo_rastreio)";
function linhaParaContato(l) {
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
    numero_id: l.numero_id ?? null
  };
}
function criarStore(db2, donoId) {
  const cacheFunis = /* @__PURE__ */ new Map();
  const cacheColunas = /* @__PURE__ */ new Map();
  return {
    agora: () => /* @__PURE__ */ new Date(),
    async funil(id) {
      if (cacheFunis.has(id)) return cacheFunis.get(id);
      const { data } = await db2.from("funis").select("id, grafo, ativo").eq("id", id).eq("dono_id", donoId).maybeSingle();
      const f = data ? { id: data.id, grafo: data.grafo, ativo: data.ativo } : null;
      cacheFunis.set(id, f);
      return f;
    },
    async produto(id) {
      const { data } = await db2.from("produtos").select("id, nome, preco_centavos, entrega_tipo, entrega_conteudo, mensagem_entrega").eq("id", id).eq("dono_id", donoId).maybeSingle();
      return data ?? null;
    },
    async colunaDoEvento(_dono, ev) {
      if (cacheColunas.has(ev)) return cacheColunas.get(ev);
      const { data } = await db2.from("kanban_colunas").select("id").eq("dono_id", donoId).eq("evento", ev).maybeSingle();
      cacheColunas.set(ev, data?.id ?? null);
      return data?.id ?? null;
    },
    async atualizarContato(c, patch2) {
      const { anuncio_codigo: _a, ...resto } = patch2;
      if (Object.keys(resto).length) await db2.from("contatos").update(resto).eq("id", c.id).eq("dono_id", donoId);
    },
    async agendar(c, tipo, executarEm, dados) {
      await db2.from("agendamentos").insert({ dono_id: donoId, contato_id: c.id, tipo, executar_em: executarEm.toISOString(), dados });
    },
    async cancelarAgendamentos(c, tipos) {
      let q = db2.from("agendamentos").update({ feito: true }).eq("contato_id", c.id).eq("feito", false);
      if (tipos?.length) q = q.in("tipo", tipos);
      await q;
    },
    async registrarExecucao(c, funilId, blocoId, saida) {
      if (c.simulacao) return;
      await db2.from("execucoes_bloco").insert({ dono_id: donoId, funil_id: funilId, bloco_id: blocoId, contato_id: c.id, saida });
    },
    async registrarMensagemRobo(c, s) {
      const conteudo = s.tipo === "texto" ? s.texto : "legenda" in s ? s.legenda : s.tipo === "arquivo" ? s.nome : null;
      await db2.from("mensagens").insert({
        dono_id: donoId,
        contato_id: c.id,
        autor: "robo",
        tipo: s.tipo,
        conteudo,
        midia_url: "url" in s ? s.url : null
      });
      await db2.from("contatos").update({ ultima_msg_em: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", c.id);
    },
    async criarPix(c, produto, expiraMin, tipo) {
      const { data: cfg } = await db2.from("configuracoes").select("taxa_percentual, taxa_fixa_centavos").eq("dono_id", donoId).maybeSingle();
      const taxa = cfg ? Math.round(produto.preco_centavos * Number(cfg.taxa_percentual) / 100) + (cfg.taxa_fixa_centavos ?? 0) : 0;
      const gw = c.simulacao ? null : await configGateway(db2, donoId);
      if (!c.simulacao && !gw) throw new Error("nenhum gateway conectado (Produtos → Gateway de Pix)");
      const { data: anuncio } = await db2.from("contatos").select("anuncio_id").eq("id", c.id).maybeSingle();
      const { data, error } = await db2.from("pagamentos").insert({
        dono_id: donoId,
        contato_id: c.id,
        produto_id: produto.id,
        anuncio_id: anuncio?.anuncio_id ?? null,
        tipo,
        valor_centavos: produto.preco_centavos,
        taxa_centavos: taxa,
        status: "pendente",
        gateway: c.simulacao ? "simulacao" : gw.gateway,
        simulacao: c.simulacao
      }).select("id").single();
      if (error || !data) throw new Error("falha ao criar pagamento");
      if (c.simulacao) {
        const copiaCola = `00020126SIMULACAO-XCLOZR-${data.id.slice(0, 8)}5204000053039865802BR (Pix de teste, não pague)`;
        await db2.from("pagamentos").update({ pix_copia_cola: copiaCola }).eq("id", data.id);
        return { id: data.id, copiaCola };
      }
      try {
        if (gw.gateway === "asaas") {
          const qr = await criarPixAsaas(gw, { pagamentoId: data.id, descricao: produto.nome, valorCentavos: produto.preco_centavos, expiraMin });
          await db2.from("pagamentos").update({ pix_copia_cola: qr.copiaCola, gateway_id: qr.qrId, verificar_em: new Date(Date.now() + 6e4).toISOString() }).eq("id", data.id);
          return { id: data.id, copiaCola: qr.copiaCola };
        }
        if (gw.gateway === "livepix") {
          const lp = await criarCobrancaLivePix(db2, gw, donoId, { pagamentoId: data.id, valorCentavos: produto.preco_centavos });
          await db2.from("pagamentos").update({ pix_copia_cola: lp.link, gateway_id: lp.referencia, verificar_em: new Date(Date.now() + 6e4).toISOString() }).eq("id", data.id);
          return { id: data.id, copiaCola: lp.link, link: lp.link };
        }
        const pix = await criarPixPagBank(gw, donoId, {
          referencia: data.id,
          descricao: produto.nome,
          valorCentavos: produto.preco_centavos,
          expiraMin,
          nome: c.nome,
          telefone: c.telefone
        });
        await db2.from("pagamentos").update({ pix_copia_cola: pix.copiaCola, gateway_id: pix.pedidoId, verificar_em: new Date(Date.now() + 6e4).toISOString() }).eq("id", data.id);
        return { id: data.id, copiaCola: pix.copiaCola };
      } catch (e) {
        await db2.from("pagamentos").delete().eq("id", data.id);
        await db2.from("gateway_config").update({ erro: String(e.message).slice(0, 300) }).eq("dono_id", donoId);
        throw e;
      }
    },
    async pagamentoPendente(c) {
      const { count } = await db2.from("pagamentos").select("id", { count: "exact", head: true }).eq("contato_id", c.id).eq("status", "pendente");
      return (count ?? 0) > 0;
    },
    async jaComprou(c) {
      const { count } = await db2.from("pagamentos").select("id", { count: "exact", head: true }).eq("contato_id", c.id).eq("status", "pago");
      return (count ?? 0) > 0;
    },
    async marcarPixExpirado(id) {
      await db2.from("pagamentos").update({ status: "expirado" }).eq("id", id).eq("status", "pendente");
    },
    async avisarDono(c, texto) {
      await db2.from("avisos").insert({ dono_id: donoId, contato_id: c.id, texto });
    }
  };
}

// supabase/functions/motor/envio.ts
var envioSimulado = { enviar: async () => {
} };
async function configMotor(db2) {
  const { data } = await db2.from("motor_config").select("chave, valor");
  return Object.fromEntries((data ?? []).map((l) => [l.chave, l.valor]));
}
function criarEnvioEvolution(db2, cfg) {
  const base2 = (cfg.evolution_url ?? "").replace(/\/+$/, "");
  const apikey = cfg.evolution_apikey ?? "";
  return {
    async enviar(c, s) {
      if (!base2 || !apikey) throw new Error("Evolution não configurada");
      const { data: numero } = await db2.from("numeros").select("instancia").eq("id", c.numero_id ?? "").maybeSingle();
      if (!numero) throw new Error("contato sem número (chip) associado");
      const inst = encodeURIComponent(numero.instancia);
      const delay = Math.min(Math.max(s.esperaMs, 0), 25e3);
      let rota;
      let corpo;
      if (s.tipo === "texto") {
        rota = `/message/sendText/${inst}`;
        corpo = { number: c.telefone, text: s.texto, delay };
      } else if (s.tipo === "audio") {
        rota = `/message/sendWhatsAppAudio/${inst}`;
        corpo = { number: c.telefone, audio: s.url, delay };
      } else {
        rota = `/message/sendMedia/${inst}`;
        corpo = {
          number: c.telefone,
          mediatype: s.tipo === "arquivo" ? "document" : s.tipo,
          media: s.url,
          caption: "legenda" in s ? s.legenda : void 0,
          fileName: s.tipo === "arquivo" ? s.nome : void 0,
          delay
        };
      }
      const r = await fetch(`${base2}${rota}`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey },
        body: JSON.stringify(corpo)
      });
      if (!r.ok) throw new Error(`Evolution ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  };
}

// supabase/functions/motor/numeros.ts
var EVENTOS = ["MESSAGES_UPSERT", "CONNECTION_UPDATE"];
function base(cfg) {
  return (cfg.evolution_url ?? "").trim().replace(/\/+$/, "");
}
async function evo(cfg, metodo, rota, corpo) {
  const r = await fetch(`${base(cfg)}${rota}`, {
    method: metodo,
    headers: { "content-type": "application/json", apikey: cfg.evolution_apikey ?? "" },
    body: corpo === void 0 ? void 0 : JSON.stringify(corpo),
    signal: AbortSignal.timeout(2e4)
  });
  const texto = await r.text();
  let dados = null;
  try {
    dados = JSON.parse(texto);
  } catch {
    dados = texto;
  }
  return { ok: r.ok, status: r.status, dados };
}
function urlWebhook(cfg) {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/motor/evolution?segredo=${encodeURIComponent(cfg.segredo_webhook ?? "")}`;
}
async function definirWebhook(cfg, inst) {
  const url = urlWebhook(cfg);
  const novo = await evo(cfg, "POST", `/webhook/set/${encodeURIComponent(inst)}`, {
    webhook: { enabled: true, url, byEvents: false, base64: false, events: EVENTOS }
  });
  if (novo.ok) return true;
  const antigo = await evo(cfg, "POST", `/webhook/set/${encodeURIComponent(inst)}`, {
    enabled: true,
    url,
    webhookByEvents: false,
    webhookBase64: false,
    events: EVENTOS
  });
  return antigo.ok;
}
function qrDe(d) {
  const b = d?.base64 ?? d?.qrcode?.base64 ?? null;
  if (!b || typeof b !== "string") return null;
  return b.startsWith("data:") ? b : `data:image/png;base64,${b}`;
}
function telefoneDe(d) {
  const jid = d?.ownerJid ?? d?.owner ?? d?.instance?.owner ?? d?.instance?.wuid;
  return jid ? jid.split("@")[0].split(":")[0] : null;
}
async function estadoEvolution(cfg, inst) {
  const r = await evo(cfg, "GET", `/instance/connectionState/${encodeURIComponent(inst)}`);
  if (r.status === 404) return "inexistente";
  const s = r.dados?.instance?.state ?? r.dados?.state ?? null;
  return s === "open" ? "conectado" : s === "connecting" ? "conectando" : "desconectado";
}
async function rotasNumeros(db2, donoId, corpo) {
  const acao = String(corpo.acao ?? "");
  let cfg = await configMotor(db2);
  const configurada = Boolean(base(cfg) && cfg.evolution_apikey);
  if (cfg.dono_admin && cfg.dono_admin !== donoId && acao === "config") return { status: 403, dados: { erro: "sem permissão" } };
  if (acao === "status") {
    let host = null;
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
      ...cfg.dono_admin ? [] : [{ chave: "dono_admin", valor: donoId }]
    ];
    const { error } = await db2.from("motor_config").upsert(linhas, { onConflict: "chave" });
    if (error) return { status: 500, dados: { erro: "Não consegui salvar." } };
    cfg = await configMotor(db2);
    const { data: nums } = await db2.from("numeros").select("instancia").eq("dono_id", donoId);
    for (const n of nums ?? []) await definirWebhook(cfg, n.instancia).catch(() => false);
    return { status: 200, dados: { ok: true, servidor: new URL(url).host } };
  }
  if (!configurada) return { status: 400, dados: { erro: "Configure o servidor da Evolution primeiro." } };
  if (acao === "criar") {
    const nome = String(corpo.nome ?? "").trim().slice(0, 60) || "Chip";
    const inst2 = `xc-${donoId.slice(0, 6)}-${crypto.randomUUID().slice(0, 8)}`;
    const r = await evo(cfg, "POST", "/instance/create", {
      instanceName: inst2,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      groupsIgnore: true,
      webhook: { enabled: true, url: urlWebhook(cfg), byEvents: false, base64: false, events: EVENTOS }
    });
    if (!r.ok) {
      const msg = typeof r.dados === "object" ? JSON.stringify(r.dados?.response?.message ?? r.dados?.message ?? r.dados).slice(0, 200) : String(r.dados).slice(0, 200);
      return { status: 400, dados: { erro: `A Evolution não criou a instância (${r.status}): ${msg}` } };
    }
    await definirWebhook(cfg, inst2).catch(() => false);
    const { data: linha, error } = await db2.from("numeros").insert({ dono_id: donoId, nome, instancia: inst2, status: "conectando" }).select("id").single();
    if (error || !linha) return { status: 500, dados: { erro: "Instância criada, mas não consegui salvar no painel." } };
    let qr = qrDe(r.dados?.qrcode ?? r.dados);
    if (!qr) {
      const c = await evo(cfg, "GET", `/instance/connect/${encodeURIComponent(inst2)}`);
      qr = qrDe(c.dados);
    }
    return { status: 200, dados: { id: linha.id, qr } };
  }
  const { data: numero } = await db2.from("numeros").select("id, instancia, status").eq("id", String(corpo.numero_id ?? "")).eq("dono_id", donoId).maybeSingle();
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
    await db2.from("numeros").update({ status: "conectando" }).eq("id", numero.id);
    return { status: 200, dados: { conectado: false, qr: qrDe(c.dados) } };
  }
  if (acao === "estado") {
    const estado = await estadoEvolution(cfg, inst);
    const status = estado === "inexistente" ? "desconectado" : estado;
    const patch2 = { status };
    if (status === "conectado") {
      const f = await evo(cfg, "GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(inst)}`);
      const item = Array.isArray(f.dados) ? f.dados[0] : f.dados;
      const tel = telefoneDe(item);
      if (tel) patch2.telefone = tel;
      if (numero.status !== "conectado") patch2.conectado_em = (/* @__PURE__ */ new Date()).toISOString();
    }
    await db2.from("numeros").update(patch2).eq("id", numero.id);
    return { status: 200, dados: { status, telefone: patch2.telefone ?? null } };
  }
  if (acao === "desconectar") {
    await evo(cfg, "DELETE", `/instance/logout/${encodeURIComponent(inst)}`);
    await db2.from("numeros").update({ status: "desconectado" }).eq("id", numero.id);
    return { status: 200, dados: { ok: true } };
  }
  if (acao === "apagar") {
    await evo(cfg, "DELETE", `/instance/logout/${encodeURIComponent(inst)}`).catch(() => null);
    await evo(cfg, "DELETE", `/instance/delete/${encodeURIComponent(inst)}`).catch(() => null);
    await db2.from("numeros").delete().eq("id", numero.id);
    return { status: 200, dados: { ok: true } };
  }
  return { status: 400, dados: { erro: "ação desconhecida" } };
}

// supabase/functions/motor/ia.ts
var MODELO_PADRAO = {
  openai: "gpt-5.4-mini",
  anthropic: "claude-haiku-5-5",
  gemini: "gemini-flash-latest"
};
var LIMITE_TOKENS = 1500;
function extrairJson(t) {
  const ini = t.indexOf("{");
  const fim = t.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try {
    return JSON.parse(t.slice(ini, fim + 1));
  } catch {
    return null;
  }
}
async function chamar2(cfg, sistema, msgs) {
  const sinal = AbortSignal.timeout(3e4);
  if (cfg.provedor === "openai") {
    const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: sinal,
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.chave}` },
      body: JSON.stringify({
        model: cfg.modelo,
        max_completion_tokens: LIMITE_TOKENS,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sistema }, ...msgs.map((m) => ({ role: m.papel === "cliente" ? "user" : "assistant", content: m.texto }))]
      })
    });
    const j2 = await r2.json().catch(() => ({}));
    if (!r2.ok) throw new Error(j2?.error?.message ?? `OpenAI ${r2.status}`);
    return { texto: String(j2.choices?.[0]?.message?.content ?? ""), entrada: j2.usage?.prompt_tokens ?? 0, saida: j2.usage?.completion_tokens ?? 0 };
  }
  if (cfg.provedor === "anthropic") {
    const juntas = [];
    for (const m of msgs) {
      const role = m.papel === "cliente" ? "user" : "assistant";
      const ult = juntas[juntas.length - 1];
      if (ult && ult.role === role) ult.content += `
${m.texto}`;
      else juntas.push({ role, content: m.texto });
    }
    if (!juntas.length || juntas[0].role !== "user") juntas.unshift({ role: "user", content: "(o cliente iniciou a conversa)" });
    if (juntas[juntas.length - 1].role !== "user") juntas.push({ role: "user", content: "(o cliente ainda não respondeu; continue a conversa)" });
    const r2 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: sinal,
      headers: { "content-type": "application/json", "x-api-key": cfg.chave, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.modelo, max_tokens: LIMITE_TOKENS, system: sistema, messages: juntas })
    });
    const j2 = await r2.json().catch(() => ({}));
    if (!r2.ok) throw new Error(j2?.error?.message ?? `Claude ${r2.status}`);
    const texto2 = (j2.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return { texto: texto2, entrada: j2.usage?.input_tokens ?? 0, saida: j2.usage?.output_tokens ?? 0 };
  }
  const contents = [];
  for (const m of msgs) {
    const role = m.papel === "cliente" ? "user" : "model";
    const ult = contents[contents.length - 1];
    if (ult && ult.role === role) ult.parts[0].text += `
${m.texto}`;
    else contents.push({ role, parts: [{ text: m.texto }] });
  }
  if (!contents.length || contents[contents.length - 1].role !== "user") contents.push({ role: "user", parts: [{ text: "(continue a conversa)" }] });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.modelo)}:generateContent`, {
    method: "POST",
    signal: sinal,
    headers: { "content-type": "application/json", "x-goog-api-key": cfg.chave },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] },
      contents,
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: LIMITE_TOKENS * 2 }
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? `Gemini ${r.status}`);
  const texto = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  return { texto, entrada: j.usageMetadata?.promptTokenCount ?? 0, saida: j.usageMetadata?.candidatesTokenCount ?? 0 };
}
function montarSistema(c, b) {
  const nome = (c.nome ?? c.campos?.nome ?? "").trim().split(/\s+/)[0] || "";
  const campos = Object.entries(c.campos ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${String(v).slice(0, 120)}`).join("; ");
  return [
    "Você é um vendedor atendendo um cliente pelo WhatsApp, em português do Brasil.",
    b.instrucoes ? `
QUEM VOCÊ É E COMO AGIR:
${b.instrucoes}` : "",
    b.conhecimento ? `
INFORMAÇÕES DO PRODUTO (use só isto; nunca invente preço, prazo ou garantia):
${b.conhecimento}` : "",
    b.objetivo ? `
OBJETIVO: ${b.objetivo}` : "\nOBJETIVO: tirar as dúvidas e levar o cliente a decidir comprar.",
    `
CLIENTE: ${nome ? `primeiro nome ${nome}` : "nome desconhecido"}${campos ? `; ${campos}` : ""}.`,
    "\nREGRAS:",
    "- Mensagens curtas e naturais, como no WhatsApp (1 a 3 frases). Sem títulos, sem markdown, no máximo 1 emoji.",
    "- Faça uma pergunta por vez. Não repita o que já foi dito.",
    "- Não envie links nem chaves Pix: o Pix é gerado pelo sistema depois que o objetivo for concluído.",
    "- Se pedirem para falar com humano, responda com educação e marque concluido como false.",
    '\nResponda SOMENTE com um JSON: {"resposta": "texto para o cliente", "concluido": true ou false}.',
    "concluido = true apenas quando o OBJETIVO foi atingido (ex.: o cliente disse claramente que quer comprar)."
  ].filter(Boolean).join("\n");
}
async function configIA(db2, donoId) {
  const { data } = await db2.from("ia_config").select("provedor, modelo, chave").eq("dono_id", donoId).maybeSingle();
  return data ? data : null;
}
async function responderIA(db2, donoId, c, bloco) {
  const cfg = await configIA(db2, donoId);
  if (!cfg) return { erro: "O agente de IA não está configurado (menu Agente de IA)." };
  const { data: hist } = await db2.from("mensagens").select("autor, conteudo, tipo").eq("contato_id", c.id).order("criado_em", { ascending: false }).limit(24);
  const msgs = (hist ?? []).reverse().map((m) => ({
    papel: m.autor === "cliente" ? "cliente" : "vendedor",
    texto: (m.conteudo || (m.tipo !== "texto" ? `[${m.tipo}]` : "")).slice(0, 1500)
  })).filter((m) => m.texto);
  try {
    const r = await chamar2(cfg, montarSistema(c, bloco), msgs);
    await db2.from("ia_uso").insert({
      dono_id: donoId,
      contato_id: c.id,
      provedor: cfg.provedor,
      modelo: cfg.modelo,
      tokens_entrada: r.entrada,
      tokens_saida: r.saida,
      simulacao: c.simulacao
    });
    const j = extrairJson(r.texto);
    const resposta = String(j?.resposta ?? (j ? "" : r.texto)).trim();
    if (!resposta) return { erro: "A IA respondeu vazio." };
    return { resposta: resposta.slice(0, 3e3), concluido: j?.concluido === true || j?.concluido === "true" };
  } catch (e) {
    return { erro: `Falha na IA (${cfg.provedor}): ${e.message}`.slice(0, 300) };
  }
}
async function testarIA(cfg) {
  const r = await chamar2(cfg, 'Responda só com o JSON {"resposta": "ok", "concluido": false}.', [{ papel: "cliente", texto: "teste" }]);
  return r.texto.length > 0;
}

// supabase/functions/motor/disparos.ts
var ETIQUETA_SAIR = "Não perturbe";
var PALAVRAS_SAIR = /* @__PURE__ */ new Set(["sair", "parar", "pare", "stop", "cancelar", "descadastrar", "nao quero mais", "remover"]);
function spintax(t) {
  let s = t;
  for (let i = 0; i < 20 && /\{[^{}]*\|[^{}]*\}/.test(s); i++) {
    s = s.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, g) => {
      const ops = g.split("|");
      return ops[Math.floor(Math.random() * ops.length)];
    });
  }
  return s;
}
function horaBrasilia2(d) {
  return new Date(d.getTime() - 3 * 36e5).getUTCHours();
}
function proximaAbertura(agora, horaInicio) {
  const b = new Date(agora.getTime() - 3 * 36e5);
  let alvo = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), horaInicio + 3, Math.floor(Math.random() * 10));
  if (alvo <= agora.getTime()) alvo += 864e5;
  return new Date(alvo);
}
function inicioDoDiaBrasilia(agora) {
  const b = new Date(agora.getTime() - 3 * 36e5);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), 3));
}
function ehPedidoSair(texto) {
  return PALAVRAS_SAIR.has(normalizar(texto).replace(/[^\p{L}\s]/gu, "").trim());
}
async function processarDisparos(db2, cfg) {
  const agora = /* @__PURE__ */ new Date();
  const { data: camps } = await db2.from("campanhas").select("*").eq("status", "enviando").lte("proximo_envio_em", agora.toISOString()).order("proximo_envio_em").limit(10);
  let feitos = 0;
  for (const cp of camps ?? []) {
    const minS = Math.max(10, cp.intervalo_min_seg);
    const maxS = Math.max(minS, cp.intervalo_max_seg);
    const espera = (minS + Math.random() * (maxS - minS)) * 1e3;
    const { data: pegou } = await db2.from("campanhas").update({ proximo_envio_em: new Date(agora.getTime() + espera).toISOString() }).eq("id", cp.id).eq("status", "enviando").lte("proximo_envio_em", agora.toISOString()).select("id");
    if (!pegou?.length) continue;
    const adiar = (quando) => db2.from("campanhas").update({ proximo_envio_em: quando.toISOString() }).eq("id", cp.id);
    const h = horaBrasilia2(agora);
    const dentro = cp.janela_inicio < cp.janela_fim ? h >= cp.janela_inicio && h < cp.janela_fim : h >= cp.janela_inicio || h < cp.janela_fim;
    if (!dentro) {
      await adiar(proximaAbertura(agora, cp.janela_inicio));
      continue;
    }
    const { data: env } = await db2.from("campanha_envios").select("id, contato_id").eq("campanha_id", cp.id).eq("status", "pendente").order("ordem").limit(1).maybeSingle();
    if (!env) {
      await db2.from("campanhas").update({ status: "concluida", concluido_em: agora.toISOString(), proximo_envio_em: null }).eq("id", cp.id);
      continue;
    }
    const ignorar = async (erro) => {
      await db2.from("campanha_envios").update({ status: "ignorado", erro }).eq("id", env.id);
      await adiar(new Date(agora.getTime() + 3e3));
    };
    const { data: linha } = await db2.from("contatos").select(CAMPOS_CONTATO).eq("id", env.contato_id).maybeSingle();
    if (!linha) {
      await ignorar("contato apagado");
      continue;
    }
    const c = linhaParaContato(linha);
    if (c.etiquetas.includes(ETIQUETA_SAIR)) {
      await ignorar("pediu para não receber");
      continue;
    }
    const { data: num } = await db2.from("numeros").select("id, status").eq("id", c.numero_id ?? "").maybeSingle();
    if (!num || num.status !== "conectado") {
      await ignorar("chip desconectado");
      continue;
    }
    const { count } = await db2.from("campanha_envios").select("id", { count: "exact", head: true }).eq("numero_id", num.id).eq("status", "enviado").gte("enviado_em", inicioDoDiaBrasilia(agora).toISOString());
    if ((count ?? 0) >= cp.limite_diario_chip) {
      await adiar(new Date(agora.getTime() + 30 * 6e4));
      continue;
    }
    try {
      const envio = criarEnvioEvolution(db2, cfg);
      const rodape = cp.incluir_sair ? "\n\n_Se não quiser mais receber, responda SAIR._" : "";
      const texto = (preencher(spintax(cp.mensagem ?? ""), c).trim() + rodape).trim();
      const saidas = [];
      if (cp.midia_url && (cp.midia_tipo === "imagem" || cp.midia_tipo === "video")) {
        saidas.push({ tipo: cp.midia_tipo, url: cp.midia_url, legenda: texto, esperaMs: 2500 });
      } else {
        if (cp.midia_url && cp.midia_tipo === "audio") saidas.push({ tipo: "audio", url: cp.midia_url, esperaMs: 3e3 });
        if (cp.midia_url && cp.midia_tipo === "arquivo") saidas.push({ tipo: "arquivo", url: cp.midia_url, nome: "arquivo", esperaMs: 2e3 });
        if (texto) saidas.push({ tipo: "texto", texto, esperaMs: 2500 });
      }
      for (const s of saidas) {
        await envio.enviar(c, s);
        await db2.from("mensagens").insert({
          dono_id: c.dono_id,
          contato_id: c.id,
          autor: "robo",
          tipo: s.tipo,
          conteudo: s.tipo === "texto" ? s.texto : "legenda" in s ? s.legenda : null,
          midia_url: "url" in s ? s.url : null
        });
      }
      await db2.from("campanha_envios").update({ status: "enviado", numero_id: num.id, enviado_em: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", env.id);
      await db2.from("campanhas").update({ enviados: (cp.enviados ?? 0) + 1 }).eq("id", cp.id);
      const patch2 = { ultima_msg_em: (/* @__PURE__ */ new Date()).toISOString() };
      if (cp.funil_id) {
        Object.assign(patch2, { funil_id: cp.funil_id, bloco_atual: null, finalizado: false, aguardando: null, pix_ativo: null, robo_ativo: true });
        await db2.from("agendamentos").update({ feito: true }).eq("contato_id", c.id).eq("feito", false);
      }
      await db2.from("contatos").update(patch2).eq("id", c.id);
      feitos++;
    } catch (e) {
      await db2.from("campanha_envios").update({ status: "falhou", erro: String(e.message).slice(0, 300) }).eq("id", env.id);
      await db2.from("campanhas").update({ falhas: (cp.falhas ?? 0) + 1 }).eq("id", cp.id);
    }
  }
  return feitos;
}

// supabase/functions/motor/index.ts
var db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false }
});
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};
function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: { ...CORS, "content-type": "application/json" } });
}
async function travar(id) {
  const agora = /* @__PURE__ */ new Date();
  const { data } = await db.from("contatos").update({ processando_ate: new Date(agora.getTime() + 45e3).toISOString() }).eq("id", id).or(`processando_ate.is.null,processando_ate.lt.${agora.toISOString()}`).select("id");
  return Boolean(data?.length);
}
async function soltar(id) {
  await db.from("contatos").update({ processando_ate: null }).eq("id", id);
}
async function carregarContato(id) {
  const { data } = await db.from("contatos").select(CAMPOS_CONTATO).eq("id", id).maybeSingle();
  return data ? linhaParaContato(data) : null;
}
async function funilPadraoDe(donoId, contato) {
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
function ctxPara(donoId, simulacao, cfg) {
  return {
    store: criarStore(db, donoId),
    envio: simulacao ? envioSimulado : criarEnvioEvolution(db, cfg),
    log: (m) => console.log(`[motor ${donoId.slice(0, 6)}] ${m}`),
    ia: (c, cfgBloco) => responderIA(db, donoId, c, cfgBloco)
  };
}
async function rotaIA(req) {
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
    const provedor = String(corpo.provedor ?? "");
    if (!["openai", "anthropic", "gemini"].includes(provedor)) return json({ erro: "Escolha a IA." }, 400);
    const modelo = String(corpo.modelo ?? "").trim() || MODELO_PADRAO[provedor];
    const chave = String(corpo.chave ?? "").trim() || (atual?.provedor === provedor ? atual.chave : "");
    if (!chave) return json({ erro: "Cole a chave de API." }, 400);
    try {
      await testarIA({ provedor, modelo, chave });
    } catch (e) {
      return json({ erro: `A ${provedor === "openai" ? "OpenAI" : provedor === "anthropic" ? "Anthropic" : "Google"} recusou: ${e.message}`.slice(0, 300) }, 400);
    }
    const { error } = await db.from("ia_config").upsert({ dono_id: donoId, provedor, modelo, chave, atualizado_em: (/* @__PURE__ */ new Date()).toISOString() });
    if (error) return json({ erro: "Não consegui salvar." }, 500);
    return json({ ok: true, provedor, modelo, final_chave: chave.slice(-4) });
  }
  return json({ erro: "ação desconhecida" }, 400);
}
async function usuarioDoJwt(req) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data: u } = await db.auth.getUser(jwt);
  return u?.user?.id ?? null;
}
async function numeros(req) {
  const donoId = await usuarioDoJwt(req);
  if (!donoId) return json({ erro: "não autenticado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const r = await rotasNumeros(db, donoId, corpo);
  return json(r.dados, r.status);
}
async function gateway(req) {
  const donoId = await usuarioDoJwt(req);
  if (!donoId) return json({ erro: "não autenticado" }, 401);
  const r = await rotaGateway(db, donoId, await req.json().catch(() => ({})));
  return json(r, "erro" in r && r.erro ? 400 : 200);
}
async function confirmarPagamento(pagamentoId, cfg) {
  const { data: pg } = await db.from("pagamentos").update({ status: "pago", pago_em: (/* @__PURE__ */ new Date()).toISOString(), verificar_em: null }).eq("id", pagamentoId).neq("status", "pago").select("id, contato_id, dono_id").maybeSingle();
  if (!pg) return false;
  for (let i = 0; i < 8; i++) {
    if (await travar(pg.contato_id)) {
      try {
        const contato = await carregarContato(pg.contato_id);
        if (contato) {
          const esperado = contato.pix_ativo?.pagamento_id === pg.id;
          await pixPago(ctxPara(pg.dono_id, false, cfg), contato, pg.id);
          if (!esperado) {
            await db.from("avisos").insert({
              dono_id: pg.dono_id,
              contato_id: pg.contato_id,
              tipo: "venda",
              texto: `Pix pago fora da hora (depois de expirar ou de outra conversa) por ${contato.nome ?? contato.telefone}. Confira e entregue manualmente em Conversas.`,
              link: "/conversas"
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
  await db.from("agendamentos").insert({ dono_id: pg.dono_id, contato_id: pg.contato_id, tipo: "pix_pago", dados: { pagamento_id: pg.id }, executar_em: new Date(Date.now() + 5e3).toISOString() });
  return true;
}
async function avisoPagBank(req, cfg) {
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
async function gatewayPago(gw, donoId, gatewayId, valorCentavos) {
  if (gw.gateway === "livepix") return await cobrancaLivePixPaga(db, gw, donoId, gatewayId, valorCentavos);
  if (gw.gateway === "asaas") return await pixAsaasPago(gw, gatewayId, valorCentavos);
  return (await pedidoPago(gw, gatewayId)).pago;
}
async function avisoLivePix(req, cfg) {
  const u = new URL(req.url);
  const donoId = u.searchParams.get("d") ?? "";
  const corpo = await req.json().catch(() => ({}));
  const gw = /^[0-9a-f-]{36}$/.test(donoId) ? await configGateway(db, donoId) : null;
  if (!gw || gw.gateway !== "livepix" || u.searchParams.get("s") !== gw.segredo_webhook) return json({ erro: "aviso inválido" }, 401);
  const recurso = corpo?.resource ?? {};
  if (recurso.type !== "payment") return json({ ok: true, ignorado: true });
  let ref = String(recurso.reference ?? "");
  if (!ref && recurso.id) ref = (await pagamentoLivePix(db, gw, donoId, String(recurso.id)))?.reference ?? "";
  if (!ref) return json({ ok: true, ignorado: true });
  const { data: pg } = await db.from("pagamentos").select("id, status, valor_centavos").eq("dono_id", donoId).eq("gateway", "livepix").eq("gateway_id", ref).maybeSingle();
  if (!pg || pg.status === "pago") return json({ ok: true });
  const pago = await cobrancaLivePixPaga(db, gw, donoId, ref, pg.valor_centavos);
  if (pago) await confirmarPagamento(pg.id, cfg);
  return json({ ok: true, pago });
}
async function avisoAsaas(req, cfg) {
  const u = new URL(req.url);
  const donoId = u.searchParams.get("d") ?? "";
  const corpo = await req.json().catch(() => ({}));
  const gw = /^[0-9a-f-]{36}$/.test(donoId) ? await configGateway(db, donoId) : null;
  if (!gw || gw.gateway !== "asaas" || u.searchParams.get("s") !== gw.segredo_webhook) return json({ erro: "aviso inválido" }, 401);
  const qrId = String(corpo?.payment?.pixQrCodeId ?? "");
  if (!qrId) return json({ ok: true, ignorado: true });
  const { data: pg } = await db.from("pagamentos").select("id, status, valor_centavos").eq("dono_id", donoId).eq("gateway", "asaas").eq("gateway_id", qrId).maybeSingle();
  if (!pg || pg.status === "pago") return json({ ok: true });
  const pago = await pixAsaasPago(gw, qrId, pg.valor_centavos);
  if (pago) await confirmarPagamento(pg.id, cfg);
  return json({ ok: true, pago });
}
async function voltaLivePix(req, cfg) {
  const u = new URL(req.url);
  const donoId = u.searchParams.get("d") ?? "";
  const pagamentoId = u.searchParams.get("p") ?? "";
  let destino = "https://wa.me/";
  try {
    const gw = /^[0-9a-f-]{36}$/.test(donoId) ? await configGateway(db, donoId) : null;
    if (gw?.gateway === "livepix" && u.searchParams.get("s") === gw.segredo_webhook && /^[0-9a-f-]{36}$/.test(pagamentoId)) {
      const { data: pg } = await db.from("pagamentos").select("id, status, valor_centavos, gateway_id, contato_id").eq("id", pagamentoId).eq("dono_id", donoId).maybeSingle();
      const { data: ct } = pg ? await db.from("contatos").select("numero_id").eq("id", pg.contato_id).maybeSingle() : { data: null };
      const { data: num } = ct?.numero_id ? await db.from("numeros").select("telefone").eq("id", ct.numero_id).maybeSingle() : { data: null };
      const tel = String(num?.telefone ?? "").replace(/\D/g, "");
      if (tel) destino = `https://wa.me/${tel}`;
      if (pg && pg.status !== "pago" && pg.gateway_id && await cobrancaLivePixPaga(db, gw, donoId, pg.gateway_id, pg.valor_centavos)) await confirmarPagamento(pg.id, cfg);
    }
  } catch (e) {
    console.error("volta LivePix", e);
  }
  return new Response(null, { status: 302, headers: { location: destino } });
}
async function conferirPendentes(cfg) {
  const agora = /* @__PURE__ */ new Date();
  const { data: pendentes } = await db.from("pagamentos").select("id, dono_id, gateway, gateway_id, valor_centavos, criado_em").eq("status", "pendente").in("gateway", ["pagbank", "livepix", "asaas"]).not("gateway_id", "is", null).lte("verificar_em", agora.toISOString()).order("verificar_em").limit(8);
  let pagos = 0;
  for (const p of pendentes ?? []) {
    const idadeMin = (agora.getTime() - new Date(p.criado_em).getTime()) / 6e4;
    const prox = idadeMin > 2880 ? null : new Date(agora.getTime() + (idadeMin < 60 ? 6e4 : 6e5)).toISOString();
    await db.from("pagamentos").update({ verificar_em: prox }).eq("id", p.id);
    try {
      const gw = await configGateway(db, p.dono_id);
      if (!gw || gw.gateway !== p.gateway) continue;
      if (await gatewayPago(gw, p.dono_id, p.gateway_id, p.valor_centavos) && await confirmarPagamento(p.id, cfg)) pagos++;
    } catch (e) {
      console.error("conferir Pix", p.id, e);
    }
  }
  return pagos;
}
async function reiniciarFluxo(req) {
  const donoId = await usuarioDoJwt(req);
  if (!donoId) return json({ erro: "não autenticado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const { data: linha } = await db.from("contatos").select(CAMPOS_CONTATO).eq("id", String(corpo.contato_id ?? "")).eq("dono_id", donoId).maybeSingle();
  if (!linha) return json({ erro: "contato não encontrado" }, 404);
  const contato = linhaParaContato(linha);
  const store = criarStore(db, donoId);
  const funil = corpo.funil_id ? await store.funil(String(corpo.funil_id)) : await funilPadraoDe(donoId, contato);
  if (!funil) return json({ erro: "Nenhum funil ativo para reiniciar. Ative um funil ou escolha qual usar." }, 400);
  if (!await travar(contato.id)) return json({ erro: "O robô está respondendo esse contato agora. Tente de novo em alguns segundos." }, 409);
  try {
    await db.from("pagamentos").update({ status: "expirado", verificar_em: null }).eq("contato_id", contato.id).eq("status", "pendente");
    const cfg = await configMotor(db);
    const ctx = ctxPara(donoId, contato.simulacao, cfg);
    await ctx.store.cancelarAgendamentos(contato);
    const reset = { funil_id: funil.id, aguardando: null, bloco_atual: null, finalizado: false, pix_ativo: null, robo_ativo: true };
    Object.assign(contato, reset);
    await ctx.store.atualizarContato(contato, reset);
    if (corpo.agora === false) return json({ ok: true, iniciado: false });
    try {
      await iniciar(ctx, contato, funil);
    } catch (e) {
      return json({ ok: true, iniciado: false, aviso: `Fluxo reiniciado, mas não consegui mandar a primeira mensagem agora (${e.message}). Ele começa quando o cliente mandar mensagem.` });
    }
    return json({ ok: true, iniciado: true });
  } finally {
    await soltar(contato.id);
  }
}
async function enviarManual(req) {
  const donoId = await usuarioDoJwt(req);
  if (!donoId) return json({ erro: "não autenticado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const texto = String(corpo.texto ?? "").trim().slice(0, 4e3);
  if (!texto) return json({ erro: "mensagem vazia" }, 400);
  const { data: linha } = await db.from("contatos").select(CAMPOS_CONTATO).eq("id", String(corpo.contato_id ?? "")).eq("dono_id", donoId).maybeSingle();
  if (!linha) return json({ erro: "conversa não encontrada" }, 404);
  const contato = linhaParaContato(linha);
  if (contato.simulacao) return json({ erro: "conversa de simulação" }, 400);
  const cfg = await configMotor(db);
  try {
    await criarEnvioEvolution(db, cfg).enviar(contato, { tipo: "texto", texto, esperaMs: 0 });
  } catch (e) {
    return json({ erro: `Não consegui enviar: ${e.message}` }, 400);
  }
  await db.from("mensagens").insert({ dono_id: donoId, contato_id: contato.id, autor: "humano", tipo: "texto", conteudo: texto });
  const patch2 = { ultima_msg_em: (/* @__PURE__ */ new Date()).toISOString() };
  if (corpo.pausar_robo !== false) patch2.robo_ativo = false;
  await db.from("contatos").update(patch2).eq("id", contato.id);
  return json({ ok: true });
}
async function simular(req) {
  const corpo = await req.json().catch(() => ({}));
  let donoId = null;
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
    const { data: novo } = await db.from("contatos").insert({ dono_id: donoId, telefone, nome: null, simulacao: true, funil_id: funilId }).select(CAMPOS_CONTATO).single();
    linha = novo;
    await evento(ctx, linhaParaContato(linha), "novo_contato");
  }
  const contato = linhaParaContato(linha);
  const inicio = new Date(Date.now() - 1e3).toISOString();
  const funil = await ctx.store.funil(funilId);
  if (acao === "mensagem") {
    const texto = String(corpo.texto ?? "").slice(0, 2e3);
    await db.from("mensagens").insert({ dono_id: donoId, contato_id: contato.id, autor: "cliente", tipo: "texto", conteudo: texto });
    await db.from("contatos").update({ ultima_msg_em: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", contato.id);
    await receberMensagem(ctx, contato, async () => funil, texto);
  } else if (acao === "pagar") {
    if (contato.pix_ativo) {
      await db.from("pagamentos").update({ status: "pago", pago_em: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", contato.pix_ativo.pagamento_id);
      await pixPago(ctx, contato, contato.pix_ativo.pagamento_id);
    }
  } else if (acao === "avancar") {
    const { data: prox2 } = await db.from("agendamentos").select("id, tipo, dados").eq("contato_id", contato.id).eq("feito", false).order("executar_em").limit(1).maybeSingle();
    if (prox2) {
      await db.from("agendamentos").update({ feito: true }).eq("id", prox2.id);
      await executarAgendamento(ctx, contato, prox2.tipo, prox2.dados ?? {});
    }
  }
  const atual = await carregarContato(contato.id);
  const { data: msgs } = await db.from("mensagens").select("autor, tipo, conteudo, midia_url, criado_em").eq("contato_id", contato.id).gte("criado_em", acao === "estado" ? "1970-01-01" : inicio).order("criado_em");
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
      proxima_espera: prox ?? null
    }
  });
}
function textoDaMensagem(m) {
  if (!m) return "";
  return m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ?? m.buttonsResponseMessage?.selectedDisplayText ?? m.listResponseMessage?.title ?? (m.audioMessage ? "[áudio]" : m.imageMessage ? "[imagem]" : m.stickerMessage ? "[figurinha]" : m.documentMessage ? "[arquivo]" : "");
}
function anuncioDaMensagem(d) {
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
    origem: { url: ad?.sourceUrl ?? ref?.sourceUrl ?? ref?.source_url ?? null, titulo: ad?.title ?? null, texto: ad?.body ?? null, em: (/* @__PURE__ */ new Date()).toISOString() }
  };
}
async function evolution(req, cfg) {
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
    const wuid = corpo.data?.wuid;
    if (status)
      await db.from("numeros").update({
        status,
        ...status === "conectado" ? { conectado_em: (/* @__PURE__ */ new Date()).toISOString() } : {},
        ...wuid ? { telefone: wuid.split("@")[0].split(":")[0] } : {}
      }).eq("id", numero.id);
    return json({ ok: true });
  }
  if (tipo !== "messages.upsert") return json({ ok: true });
  const d = corpo.data ?? {};
  const jid = d.key?.remoteJid ?? "";
  if (!jid.endsWith("@s.whatsapp.net")) return json({ ok: true });
  const telefone = jid.split("@")[0];
  const texto = textoDaMensagem(d.message);
  const donoId = numero.dono_id;
  let { data: linha } = await db.from("contatos").select(CAMPOS_CONTATO).eq("dono_id", donoId).eq("telefone", telefone).maybeSingle();
  if (d.key?.fromMe) {
    if (linha) {
      const { data: ult } = await db.from("mensagens").select("conteudo").eq("contato_id", linha.id).in("autor", ["robo", "humano"]).gte("criado_em", new Date(Date.now() - 12e4).toISOString());
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
    await db.from("contatos").update({ meta_ad_id: anuncio.id, ctwa_clid: anuncio.ctwa, origem: anuncio.origem }).eq("id", linha.id);
  }
  if (!linha) {
    const { data: novo } = await db.from("contatos").insert({ dono_id: donoId, telefone, nome: d.pushName ?? null, numero_id: numero.id, ...anuncio ? { meta_ad_id: anuncio.id, ctwa_clid: anuncio.ctwa, origem: anuncio.origem } : {} }).select(CAMPOS_CONTATO).single();
    linha = novo;
    await evento(ctx, linhaParaContato(linha), "novo_contato");
  }
  const contato = linhaParaContato(linha);
  await db.from("mensagens").insert({ dono_id: donoId, contato_id: contato.id, autor: "cliente", tipo: "texto", conteudo: texto, wa_id: d.key?.id });
  await db.from("contatos").update({ ultima_msg_em: (/* @__PURE__ */ new Date()).toISOString(), numero_id: numero.id }).eq("id", contato.id);
  const tresDias = new Date(Date.now() - 3 * 864e5).toISOString();
  await db.from("campanha_envios").update({ respondeu_em: (/* @__PURE__ */ new Date()).toISOString() }).eq("contato_id", contato.id).eq("status", "enviado").is("respondeu_em", null).gte("enviado_em", tresDias);
  if (ehPedidoSair(texto)) {
    const { count } = await db.from("campanha_envios").select("id", { count: "exact", head: true }).eq("contato_id", contato.id).eq("status", "enviado").gte("enviado_em", new Date(Date.now() - 7 * 864e5).toISOString());
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
  if (!await travar(contato.id)) {
    await ctx.store.agendar(contato, "reprocessar", new Date(Date.now() + 3e3), { texto });
    return json({ ok: true, enfileirado: true });
  }
  try {
    const atual = await carregarContato(contato.id);
    await receberMensagem(ctx, atual, () => funilPadraoDe(donoId, atual), texto);
  } catch (e) {
    console.error("erro ao processar mensagem", e);
  } finally {
    await soltar(contato.id);
  }
  return json({ ok: true });
}
async function relogio(req, cfg) {
  if (!cfg.segredo_relogio || req.headers.get("x-segredo") !== cfg.segredo_relogio) return json({ erro: "segredo inválido" }, 401);
  const { data: vencidos } = await db.from("agendamentos").select("id, dono_id, contato_id, tipo, dados").eq("feito", false).lte("executar_em", (/* @__PURE__ */ new Date()).toISOString()).order("executar_em").limit(40);
  let feitos = 0;
  for (const a of vencidos ?? []) {
    const { data: pegou } = await db.from("agendamentos").update({ feito: true }).eq("id", a.id).eq("feito", false).select("id");
    if (!pegou?.length) continue;
    if (!await travar(a.contato_id)) {
      await db.from("agendamentos").update({ feito: false, executar_em: new Date(Date.now() + 3e3).toISOString() }).eq("id", a.id);
      continue;
    }
    try {
      const contato = await carregarContato(a.contato_id);
      if (!contato) continue;
      const ctx = ctxPara(a.dono_id, contato.simulacao, cfg);
      if (a.tipo === "pix_pago") {
        await pixPago(ctx, contato, String(a.dados?.pagamento_id ?? ""));
      } else if (a.tipo === "reprocessar") {
        await receberMensagem(ctx, contato, () => funilPadraoDe(a.dono_id, contato), String(a.dados?.texto ?? ""));
      } else {
        await executarAgendamento(ctx, contato, a.tipo, a.dados ?? {});
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
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const rota = new URL(req.url).pathname.replace(/^.*\/motor/, "") || "/";
  try {
    if (rota === "/saude") return json({ ok: true, motor: "xclozr", hora: (/* @__PURE__ */ new Date()).toISOString() });
    if (rota === "/simular" && req.method === "POST") return await simular(req);
    if (rota === "/numeros" && req.method === "POST") return await numeros(req);
    if (rota === "/enviar" && req.method === "POST") return await enviarManual(req);
    if (rota === "/reiniciar" && req.method === "POST") return await reiniciarFluxo(req);
    if (rota === "/ia" && req.method === "POST") return await rotaIA(req);
    if (rota === "/gateway" && req.method === "POST") return await gateway(req);
    const cfg = await configMotor(db);
    if (rota === "/evolution" && req.method === "POST") return await evolution(req, cfg);
    if (rota === "/relogio" && req.method === "POST") return await relogio(req, cfg);
    if (rota === "/pagbank" && req.method === "POST") return await avisoPagBank(req, cfg);
    if (rota === "/livepix" && req.method === "POST") return await avisoLivePix(req, cfg);
    if (rota === "/asaas" && req.method === "POST") return await avisoAsaas(req, cfg);
    if (rota === "/livepix-volta" && req.method === "GET") return await voltaLivePix(req, cfg);
    return json({ erro: "rota não encontrada" }, 404);
  } catch (e) {
    console.error(e);
    return json({ erro: "falha interna" }, 500);
  }
});
