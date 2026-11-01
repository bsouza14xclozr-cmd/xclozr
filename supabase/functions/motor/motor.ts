/**
 * XClozr — cérebro do funil.
 * Executa o desenho feito no editor, bloco por bloco, para um contato.
 * Não depende de Deno nem de Supabase diretamente: recebe um "Store" (banco) e um "Envio" (WhatsApp),
 * o que permite testar tudo com dados em memória.
 */

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type Config = Record<string, any>;
export type No = { id: string; data: { tipo: string; config: Config } };
export type Ligacao = { source: string; sourceHandle?: string | null; target: string };
export type Grafo = { nodes: No[]; edges: Ligacao[] };
export type Funil = { id: string; grafo: Grafo };

export type Aguardando = {
  bloco: string;
  tipo: "pergunta" | "menu" | "objecoes" | "upsell" | "esperar" | "ia";
  token: string;
  tentativas: number;
  cancelaSeResponder?: boolean;
};
export type PixAtivo = { bloco: string; pagamento_id: string; funil_id: string; tipo?: "principal" | "upsell" };

export type Contato = {
  id: string;
  dono_id: string;
  telefone: string;
  nome: string | null;
  funil_id: string | null;
  bloco_atual: string | null;
  aguardando: Aguardando | null;
  pix_ativo: PixAtivo | null;
  finalizado: boolean;
  ja_respondeu: boolean;
  robo_ativo: boolean;
  campos: Record<string, string>;
  etiquetas: string[];
  kanban_coluna_id: string | null;
  anuncio_codigo: string | null;
  simulacao: boolean;
};

export type Produto = {
  id: string;
  nome: string;
  preco_centavos: number;
  entrega_tipo: "link" | "arquivo" | "codigo";
  entrega_conteudo: string | null;
  mensagem_entrega: string | null;
};

export type Evento = "novo_contato" | "respondeu" | "pix_gerado" | "pagou" | "pix_expirou" | "upsell_aceito" | "humano";

export type Saida =
  | { tipo: "texto"; texto: string; esperaMs: number }
  | { tipo: "imagem" | "video"; url: string; legenda: string; esperaMs: number }
  | { tipo: "audio"; url: string; esperaMs: number }
  | { tipo: "arquivo"; url: string; nome: string; esperaMs: number };

export type PatchContato = Partial<Omit<Contato, "id" | "dono_id" | "telefone" | "simulacao">>;

export interface Store {
  agora(): Date;
  funil(id: string): Promise<Funil | null>;
  produto(id: string): Promise<Produto | null>;
  colunaDoEvento(donoId: string, evento: Evento): Promise<string | null>;
  atualizarContato(c: Contato, patch: PatchContato): Promise<void>;
  agendar(c: Contato, tipo: string, executarEm: Date, dados: Record<string, unknown>): Promise<void>;
  cancelarAgendamentos(c: Contato, tipos?: string[]): Promise<void>;
  registrarExecucao(c: Contato, funilId: string, blocoId: string, saida: string | null): Promise<void>;
  registrarMensagemRobo(c: Contato, s: Saida): Promise<void>;
  criarPix(c: Contato, produto: Produto, expiraMin: number, tipo: "principal" | "upsell"): Promise<{ id: string; copiaCola: string; qrBase64?: string | null }>;
  pagamentoPendente(c: Contato): Promise<boolean>;
  jaComprou(c: Contato): Promise<boolean>;
  marcarPixExpirado(pagamentoId: string): Promise<void>;
  avisarDono(c: Contato, texto: string): Promise<void>;
}

export interface Envio {
  enviar(c: Contato, s: Saida): Promise<void>;
}

export type RespostaIA = { resposta: string; concluido: boolean } | { erro: string };
export type Ctx = { store: Store; envio: Envio; log?: (m: string) => void; ia?: (c: Contato, cfg: Config) => Promise<RespostaIA> };

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

const MAX_PASSOS = 60;

export function normalizar(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** "quero, pix, bora" → ["quero","pix","bora"] */
export function palavras(lista: string | undefined | null) {
  return (lista ?? "")
    .split(",")
    .map((p) => normalizar(p))
    .filter(Boolean);
}

/** A mensagem contém alguma das palavras (como palavra inteira ou expressão). */
export function contemAlguma(texto: string, lista: string[]) {
  const t = ` ${normalizar(texto).replace(/[^\p{L}\p{N}\s]/gu, " ")} `;
  return lista.some((p) => t.includes(` ${p} `) || (p.includes(" ") && t.includes(p)));
}

function brl(centavos: number) {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function primeiroNome(n: string | null) {
  return (n ?? "").trim().split(/\s+/)[0] ?? "";
}

export function preencher(texto: string, c: Contato, extra: Record<string, string> = {}) {
  const vars: Record<string, string> = {
    ...c.campos,
    nome: primeiroNome(c.nome) || primeiroNome(c.campos.nome ?? null) || "",
    nome_completo: c.nome ?? c.campos.nome ?? "",
    telefone: c.telefone,
    ...extra,
  };
  return (texto ?? "").replace(/\{([a-z0-9_]+)\}/gi, (m, k: string) => (k.toLowerCase() in vars ? vars[k.toLowerCase()] : m)).replace(/ {2,}/g, " ");
}

function token() {
  return Math.random().toString(36).slice(2, 10);
}

function minutos(n: unknown, padrao: number) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : padrao;
}

function addMin(d: Date, min: number) {
  return new Date(d.getTime() + min * 60_000);
}

function no(f: Funil, id: string) {
  return f.grafo.nodes.find((n) => n.id === id) ?? null;
}

function proximo(f: Funil, blocoId: string, saida: string) {
  const e = f.grafo.edges.find((x) => x.source === blocoId && (x.sourceHandle ?? "seguir") === saida);
  return e?.target ?? null;
}

/* ------------------------------------------------------------------ */
/* Eventos do CRM                                                      */
/* ------------------------------------------------------------------ */

export async function evento(ctx: Ctx, c: Contato, ev: Evento) {
  const coluna = await ctx.store.colunaDoEvento(c.dono_id, ev);
  if (coluna && coluna !== c.kanban_coluna_id) await patch(ctx, c, { kanban_coluna_id: coluna });
}

async function patch(ctx: Ctx, c: Contato, p: PatchContato) {
  Object.assign(c, p);
  await ctx.store.atualizarContato(c, p);
}

async function enviar(ctx: Ctx, c: Contato, s: Saida) {
  await ctx.envio.enviar(c, s);
  await ctx.store.registrarMensagemRobo(c, s);
}

async function enviarTexto(ctx: Ctx, c: Contato, texto: string, esperaMs = 1500) {
  const t = preencher(texto, c).trim();
  if (t) await enviar(ctx, c, { tipo: "texto", texto: t, esperaMs });
}

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

async function enviarRespostaIA(ctx: Ctx, c: Contato, texto: string, dividir: boolean) {
  const partes = dividir ? texto.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).slice(0, 4) : [texto.trim()];
  for (const p of partes) await enviar(ctx, c, { tipo: "texto", texto: p, esperaMs: Math.min(6000, 900 + p.length * 35) });
}

type Resultado = { saida: string } | { espera: Aguardando } | { parar: true; finalizar?: boolean };

/** Começa (ou recomeça) o funil do contato a partir do Início. */
export async function iniciar(ctx: Ctx, c: Contato, funil: Funil) {
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

/** Anda pelo funil a partir de um bloco até precisar esperar ou acabar. */
export async function executarDesde(ctx: Ctx, c: Contato, funilInicial: Funil, blocoId: string | null, ultimaMensagem: string) {
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

    // "Ir para outro funil" troca o funil e continua do Início dele
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
  // acabou o caminho
  await patch(ctx, c, { finalizado: true, aguardando: null });
}

async function esperarResposta(ctx: Ctx, c: Contato, n: No, tipo: Aguardando["tipo"], esperarMin: number, extra: Partial<Aguardando> = {}): Promise<Resultado> {
  const t = token();
  await ctx.store.cancelarAgendamentos(c, ["timeout", "esperar"]);
  await ctx.store.agendar(c, tipo === "esperar" ? "esperar" : "timeout", addMin(ctx.store.agora(), esperarMin), { bloco: n.id, token: t });
  return { espera: { bloco: n.id, tipo, token: t, tentativas: 0, ...extra } };
}

async function executarBloco(ctx: Ctx, c: Contato, funil: Funil, n: No, ultimaMensagem: string): Promise<Resultado> {
  const cfg = n.data.config ?? {};
  ctx.log?.(`bloco ${n.data.tipo} (${n.id})`);

  switch (n.data.tipo) {
    case "inicio":
      return { saida: "seguir" };

    case "mensagem": {
      let espera = 1200;
      for (const item of (cfg.itens ?? []) as any[]) {
        if (item.tipo === "espera") {
          espera = Math.max(0, Number(item.segundos) || 0) * 1000;
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
      const opcoes = (cfg.opcoes ?? []) as string[];
      const linhas = opcoes.map((o, i) => `*${i + 1}.* ${o}`).join("\n");
      await enviarTexto(ctx, c, [cfg.texto ?? "", linhas].filter(Boolean).join("\n\n"));
      return esperarResposta(ctx, c, n, "menu", minutos(cfg.esperarMin, 60));
    }

    case "objecoes":
      // não envia nada ao entrar: fica ouvindo o cliente (normalmente vem logo depois da oferta)
      return esperarResposta(ctx, c, n, "objecoes", minutos(cfg.esperarMin, 120));

    case "upsell":
      await enviarTexto(ctx, c, cfg.texto ?? "");
      return esperarResposta(ctx, c, n, "upsell", minutos(cfg.esperarMin, 30));

    case "esperar": {
      const mult: Record<string, number> = { segundos: 1 / 60, minutos: 1, horas: 60, dias: 1440 };
      const min = (Number(cfg.quantidade) || 1) * (mult[cfg.unidade] ?? 1);
      return esperarResposta(ctx, c, n, "esperar", min, { cancelaSeResponder: Boolean(cfg.cancelaSeResponder) });
    }

    case "condicao": {
      const regras = (cfg.regras ?? []) as any[];
      if (!regras.length) return { saida: "sim" };
      const resultados = await Promise.all(regras.map((r) => avaliarRegra(ctx, c, r, ultimaMensagem)));
      const ok = cfg.logica === "qualquer" ? resultados.some(Boolean) : resultados.every(Boolean);
      return { saida: ok ? "sim" : "nao" };
    }

    case "acao": {
      for (const a of (cfg.acoes ?? []) as any[]) {
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
      const opcoes = (cfg.opcoes ?? []) as string[];
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
      const anterior = no(funil, (funil.grafo.edges.find((e) => e.target === n.id)?.source) ?? "");
      const tipoPix = anterior?.data.tipo === "upsell" ? "upsell" : "principal";
      const expira = minutos(cfg.expiraMin, 1440);
      const pix = await ctx.store.criarPix(c, produto, expira, tipoPix);
      await enviarTexto(ctx, c, preencher(cfg.texto || "Aqui está o seu Pix de {preco} 👇", c, { produto: produto.nome, preco: brl(produto.preco_centavos) }));
      await enviar(ctx, c, { tipo: "texto", texto: pix.copiaCola, esperaMs: 800 });
      await patch(ctx, c, { pix_ativo: { bloco: n.id, pagamento_id: pix.id, funil_id: funil.id, tipo: tipoPix } });
      await ctx.store.cancelarAgendamentos(c, ["pix_nao_pagou", "pix_expirou"]);
      await ctx.store.agendar(c, "pix_nao_pagou", addMin(ctx.store.agora(), minutos(cfg.esperarMin, 15)), { bloco: n.id, pagamento_id: pix.id });
      await ctx.store.agendar(c, "pix_expirou", addMin(ctx.store.agora(), expira), { bloco: n.id, pagamento_id: pix.id });
      // no upsell o cliente já comprou: não volta para a coluna "Pix gerado"
      if (tipoPix === "principal") await evento(ctx, c, "pix_gerado");
      await ctx.store.registrarExecucao(c, funil.id, n.id, null);
      // fica parado esperando o pagamento (ou os lembretes)
      return { parar: true };
    }

    case "entregar": {
      const produto = cfg.produtoId ? await ctx.store.produto(String(cfg.produtoId)) : null;
      const texto = cfg.texto || produto?.mensagem_entrega || "Pagamento confirmado! ✅";
      await enviarTexto(ctx, c, preencher(texto, c, produto ? { produto: produto.nome, preco: brl(produto.preco_centavos) } : {}));
      if (produto?.entrega_conteudo) {
        if (produto.entrega_tipo === "arquivo") {
          await enviar(ctx, c, { tipo: "arquivo", url: produto.entrega_conteudo, nome: produto.nome, esperaMs: 1000 });
        } else {
          await enviar(ctx, c, { tipo: "texto", texto: produto.entrega_conteudo, esperaMs: 1000 });
        }
      }
      return { saida: "seguir" };
    }

    case "integracao": {
      try {
        const headers = cfg.headers ? JSON.parse(preencher(cfg.headers, c)) : {};
        const corpo = cfg.corpo ? preencher(cfg.corpo, c) : undefined;
        const metodo = String(cfg.metodo || "POST").toUpperCase();
        if (!String(cfg.url || "").startsWith("https://")) return { saida: "erro" };
        const r = await fetch(preencher(cfg.url, c), {
          method: metodo,
          headers: { "content-type": "application/json", ...headers },
          body: metodo === "GET" ? undefined : corpo,
        });
        const txt = (await r.text()).slice(0, 2000);
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

async function avaliarRegra(ctx: Ctx, c: Contato, r: any, ultimaMensagem: string): Promise<boolean> {
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

function paraMin(hhmm: string) {
  const m = hhmm.match(/^(\d{1,2}):?(\d{2})?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2] ?? 0);
}
function horaBrasilia(d: Date) {
  const b = new Date(d.getTime() - 3 * 3600_000);
  return b.getUTCHours() * 60 + b.getUTCMinutes();
}
function diaBrasilia(d: Date) {
  return new Date(d.getTime() - 3 * 3600_000).getUTCDay();
}

/* ------------------------------------------------------------------ */
/* Entradas do motor                                                   */
/* ------------------------------------------------------------------ */

/** Cliente mandou uma mensagem. */
export async function receberMensagem(ctx: Ctx, c: Contato, funilPadrao: () => Promise<Funil | null>, texto: string) {
  if (!c.ja_respondeu && (c.bloco_atual || c.finalizado)) {
    await patch(ctx, c, { ja_respondeu: true });
    await evento(ctx, c, "respondeu");
  }
  if (!c.robo_ativo) return;

  // primeira mensagem (ou funil ainda não começou)
  if (!c.funil_id || (!c.bloco_atual && !c.finalizado)) {
    const f = (c.funil_id && (await ctx.store.funil(c.funil_id))) || (await funilPadrao());
    if (f) await iniciar(ctx, c, f);
    return;
  }

  const funil = await ctx.store.funil(c.funil_id);
  if (!funil) return;
  const ag = c.aguardando;
  if (!ag) return; // não está esperando nada (ex.: aguardando pagamento, ou funil terminou)
  const n = no(funil, ag.bloco);
  if (!n) return;
  const cfg = n.data.config ?? {};

  const seguir = async (saida: string) => {
    await ctx.store.cancelarAgendamentos(c, ["timeout", "esperar"]);
    await ctx.store.registrarExecucao(c, funil.id, n.id, saida);
    await patch(ctx, c, { aguardando: null });
    await executarDesde(ctx, c, funil, proximo(funil, n.id, saida), texto);
  };
  const repetir = async (msg: string) => {
    await enviarTexto(ctx, c, msg);
    await patch(ctx, c, { aguardando: { ...ag, tentativas: ag.tentativas + 1 } });
  };

  switch (ag.tipo) {
    case "pergunta": {
      const tipo = cfg.tipoResposta ?? "texto";
      const t = texto.trim();
      const valido =
        tipo === "qualquer" ||
        (tipo === "numero" && /\d/.test(t)) ||
        (tipo === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) ||
        (tipo === "texto" && t.length > 0);
      if (valido) {
        if (cfg.salvarEm) {
          const chave = String(cfg.salvarEm);
          const extra: PatchContato = { campos: { ...c.campos, [chave]: t } };
          if (chave === "nome") extra.nome = t;
          await patch(ctx, c, extra);
        }
        return seguir("respondeu");
      }
      if (ag.tentativas + 1 >= minutos(cfg.tentativas, 2)) return seguir("invalida");
      return repetir(cfg.msgInvalida || "Não entendi, pode responder de novo?");
    }

    case "menu": {
      const opcoes = (cfg.opcoes ?? []) as string[];
      const num = texto.match(/\d+/);
      let i = num ? Number(num[0]) - 1 : -1;
      if (!(i >= 0 && i < opcoes.length)) i = opcoes.findIndex((o) => normalizar(texto).includes(normalizar(o)) && normalizar(o).length > 0);
      if (i >= 0) return seguir(`opcao_${i}`);
      return repetir(cfg.msgInvalida || "Responda só com o número da opção 🙂");
    }

    case "objecoes": {
      if (contemAlguma(texto, palavras(cfg.palavrasCompra))) return seguir("comprar");
      const obj = ((cfg.objecoes ?? []) as { palavras: string; resposta: string }[]).find((o) => contemAlguma(texto, palavras(o.palavras)));
      if (obj?.resposta) return repetir(obj.resposta);
      if (cfg.naoEntendeu) return repetir(cfg.naoEntendeu);
      return;
    }

    case "upsell": {
      if (contemAlguma(texto, palavras(cfg.palavrasSim))) return seguir("aceitou");
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

/** Uma tarefa com hora marcada venceu. */
export async function executarAgendamento(ctx: Ctx, c: Contato, tipo: string, dados: Record<string, any>) {
  if (!c.funil_id && !dados.funil_id) return;

  if (tipo === "pix_nao_pagou" || tipo === "pix_expirou") {
    if (!c.pix_ativo || c.pix_ativo.pagamento_id !== dados.pagamento_id) return; // já pagou ou outro Pix
    const funil = await ctx.store.funil(c.pix_ativo.funil_id);
    if (!funil) return;
    if (tipo === "pix_expirou") {
      await ctx.store.marcarPixExpirado(dados.pagamento_id);
      await ctx.store.cancelarAgendamentos(c);
      await patch(ctx, c, { pix_ativo: null });
      await evento(ctx, c, "pix_expirou");
    }
    if (!c.robo_ativo) return;
    const saida = tipo === "pix_expirou" ? "expirou" : "nao_pagou";
    await ctx.store.registrarExecucao(c, funil.id, dados.bloco, saida);
    await executarDesde(ctx, c, funil, proximo(funil, dados.bloco, saida), "");
    return;
  }

  // timeout / esperar: só vale se o contato ainda estiver parado no mesmo bloco
  const ag = c.aguardando;
  if (!ag || ag.bloco !== dados.bloco || ag.token !== dados.token || !c.funil_id) return;
  const funil = await ctx.store.funil(c.funil_id);
  if (!funil || !c.robo_ativo) return;
  const saida = tipo === "esperar" ? "seguir" : "sem_resposta";
  await ctx.store.registrarExecucao(c, funil.id, ag.bloco, saida);
  await patch(ctx, c, { aguardando: null });
  await executarDesde(ctx, c, funil, proximo(funil, ag.bloco, saida), "");
}

/** O gateway confirmou o pagamento. */
export async function pixPago(ctx: Ctx, c: Contato, pagamentoId: string) {
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
