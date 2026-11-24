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
export type Funil = { id: string; grafo: Grafo; ativo?: boolean };

export type Aguardando = {
  bloco: string;
  tipo: "pergunta" | "menu" | "objecoes" | "upsell" | "esperar" | "ia";
  token: string;
  tentativas: number;
  cancelaSeResponder?: boolean;
  /** já mandou o empurrãozinho para "amém/🙏" neste bloco */
  reacoes?: number;
  atendente?: number; // objeções aberta pelo Atendente IA logo na 1ª mensagem
  /** já mandou a resposta padrão ("não entendi") neste bloco */
  padrao?: number;
};
export type PixAtivo = { bloco: string; pagamento_id: string; funil_id: string; tipo?: "principal" | "upsell"; bump?: string | null };

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
  | { tipo: "arquivo"; url: string; nome: string; esperaMs: number }
  /** mensagem com botão nativo "Copiar código" (Evolution sendButtons) */
  | { tipo: "botao_copiar"; titulo: string; texto: string; codigo: string; rotulo: string; rodape?: string; esperaMs: number }
  | { tipo: "botao_pix"; titulo: string; texto: string; chave: string; tipoChave: TipoChave; nome: string; rodape?: string; esperaMs: number };

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
  /** manual: Pix pela chave (outro banco), sem cobrança no gateway: só registra o pagamento pendente. */
  criarPix(c: Contato, produto: Produto, expiraMin: number, tipo: "principal" | "upsell", manual?: boolean): Promise<{ id: string; copiaCola: string; qrBase64?: string | null; link?: string | null }>;
  pagamentoPendente(c: Contato): Promise<boolean>;
  jaComprou(c: Contato): Promise<boolean>;
  marcarPixExpirado(pagamentoId: string): Promise<void>;
  avisarDono(c: Contato, texto: string): Promise<void>;
}

export interface Envio {
  enviar(c: Contato, s: Saida): Promise<void>;
}

export type RespostaIA = { resposta: string; concluido: boolean } | { erro: string };
export type Ctx = { store: Store; envio: Envio; log?: (m: string) => void; ia?: (c: Contato, cfg: Config) => Promise<RespostaIA>; voz?: (c: Contato, texto: string) => Promise<string | null> };

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

/** "não quero", "nao", "n", "agora não"… → o cliente está recusando (não conta como compra). */
export function negou(texto: string) {
  const t = ` ${normalizar(texto).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ")} `;
  return / (nao|naum|naon|nao quero|n|nem|nunca|jamais|dispenso|sem interesse) /.test(t);
}

/** "quero saber", "queria ver", "como funciona", "?"… → é pergunta, não pedido de compra. */
export function querInformacao(texto: string) {
  const t = ` ${normalizar(texto).replace(/[^\p{L}\p{N}\s?]/gu, " ").replace(/\s+/g, " ")} `;
  return /\?/.test(t) || / (quero|queria|gostaria de|preciso) (saber|entender|ver|conhecer|mais informac|informac|detalhes)/.test(t) || / (como funciona|o que vem|o que e|mais info|me explica|explica melhor) /.test(t);
}

const ACEITES = ["sim", "quero", "pode", "manda", "mande", "bora", "aceito", "claro", "ok", "combinado", "fechado", "beleza", "blz", "positivo", "vamos", "vamo", "desejo", "gostaria", "fechou", "pode ser", "pode mandar", "quero sim", "manda sim", "pode enviar", "envia", "envie", "uhum", "s"];

/** "simmm" → "sim", "querooo" → "quero" (letras repetidas do jeito que se digita no WhatsApp). */
export function semRepeticao(t: string) {
  return normalizar(t).replace(/([a-z])\1{2,}/g, "$1").replace(/([a-z])\1(?=\b)/g, "$1");
}

/** A mensagem é um "sim, quero" de verdade? (para a IA não fechar venda com pergunta ou comentário) */
export function aceitou(texto: string, extras: string[] = []) {
  if (negou(texto) || querInformacao(texto)) return false;
  const t = semRepeticao(texto).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!t || t.split(" ").length > 12) return false; // texto longo = conversa, não aceite
  return contemAlguma(t, [...ACEITES, ...extras.map(semRepeticao)]);
}

/** "amém", "🙏", "glória", "obrigado", "isso", "." … → reação, não pergunta nem compra. */
export function ehReacao(texto: string) {
  const t = normalizar(texto).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!t) return true; // só emoji / pontuação
  return /^(amem|amen|amem amem|gloria( a deus)?|aleluia|deus (e bom|abencoe|te abencoe)|obrigad[oa]|obg|valeu|vlw|isso|isso mesmo|show|top|legal|entendi|ah ta|ata|blz|beleza|massa|perfeito|otimo|ok ok|kk+|haha+|rs+|hum+|hmm+)( [a-z]+)?$/.test(t);
}

function brl(centavos: number) {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Primeiro nome apresentável: "MATHEUS" → "Matheus"; nomes de usuário ("katarinasantiagobarbosa", "joao_123") → "". */
export function primeiroNome(n: string | null) {
  const bruto = (n ?? "").trim();
  if (!bruto) return "";
  const p = bruto.split(/\s+/)[0].replace(/[^\p{L}'-]/gu, "");
  if (!p || p.length < 2) return "";
  if (/[\d_@.]/.test(bruto.split(/\s+/)[0])) return "";
  if (!/\s/.test(bruto) && p.length > 12) return ""; // parece login colado, não nome
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

export function preencher(texto: string, c: Contato, extra: Record<string, string> = {}) {
  const vars: Record<string, string> = {
    ...c.campos,
    nome: primeiroNome(c.nome) || primeiroNome(c.campos.nome ?? null) || "",
    nome_completo: c.nome ?? c.campos.nome ?? "",
    telefone: c.telefone,
    ...extra,
  };
  return (texto ?? "")
    .replace(/\{([a-z0-9_]+)\}/gi, (m, k: string) => (k.toLowerCase() in vars ? vars[k.toLowerCase()] : m))
    .replace(/ {2,}/g, " ")
    // sem nome: "Graça e paz, !" → "Graça e paz!" · ", imagina…" → "Imagina…"
    .replace(/[ \t]*,[ \t]*([!?.])/g, "$1")
    .replace(/(^|\n)[ \t]*,[ \t]*(\p{L})/gu, (_m, ini: string, l: string) => ini + l.toUpperCase());
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

export type TipoChave = "email" | "cpf" | "cnpj" | "phone" | "random";
/** Descobre o tipo da chave Pix pelo formato. */
export function tipoDaChave(chave: string): TipoChave {
  const k = chave.trim();
  if (/@/.test(k)) return "email";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return "random";
  const d = k.replace(/\D/g, "");
  if (/^\+/.test(k) || (d.length >= 12 && d.startsWith("55"))) return "phone";
  if (d.length === 14) return "cnpj";
  if (d.length === 11 && /[.-]/.test(k)) return "cpf";
  return d.length === 11 ? "cpf" : "random";
}
const NOME_TIPO_CHAVE: Record<TipoChave, string> = { email: "e-mail", cpf: "CPF", cnpj: "CNPJ", phone: "celular", random: "aleatória" };
export const MSG_COMPROVANTE = "Conseguiu fazer o Pix? 🙏 Se já pagou, me manda o print do comprovante aqui que eu já te libero o material!";

type Resultado = { saida: string } | { espera: Aguardando } | { parar: true; finalizar?: boolean };

/** Começa (ou recomeça) o funil do contato a partir do Início. */
/** Bloco de conversa que o Atendente IA usa quando atende desde a 1ª mensagem (objeções com IA). */
export function blocoAtendente(funil: Funil): No | null {
  const inicio = funil.grafo.nodes.find((n) => n.data.tipo === "inicio");
  if (!inicio?.data.config?.atendenteIA) return null;
  const objs = funil.grafo.nodes.filter((n) => n.data.tipo === "objecoes");
  return objs.find((n) => n.data.config?.iaLigada) ?? objs[0] ?? null;
}

export async function iniciar(ctx: Ctx, c: Contato, funil: Funil, primeiraMensagem = "") {
  await ctx.store.cancelarAgendamentos(c);
  await patch(ctx, c, { funil_id: funil.id, aguardando: null, bloco_atual: null, finalizado: false });
  const inicio = funil.grafo.nodes.find((n) => n.data.tipo === "inicio");
  // Atendente IA ligado: pula o roteiro de abertura e a IA já responde o que o cliente escreveu
  const atend = primeiraMensagem.trim() && ctx.ia ? blocoAtendente(funil) : null;
  if (inicio && atend) {
    await ctx.store.registrarExecucao(c, funil.id, inicio.id, "atendente");
    await patch(ctx, c, { bloco_atual: atend.id });
    const r = await esperarResposta(ctx, c, atend, "objecoes", minutos(atend.data.config?.esperarMin, 120), { atendente: 1 });
    if ("espera" in r) await patch(ctx, c, { aguardando: r.espera });
    await receberMensagem(ctx, c, async () => funil, primeiraMensagem);
    return;
  }
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
        } else if ((item.tipo === "imagem" || item.tipo === "video" || item.tipo === "audio") && item.url) {
          // mídia que falhar (link quebrado, formato) não trava o funil: avisa você e segue para o próximo item
          const s: Saida = item.tipo === "audio" ? { tipo: "audio", url: item.url, esperaMs: espera } : { tipo: item.tipo, url: item.url, legenda: preencher(item.legenda ?? "", c), esperaMs: espera };
          try {
            await enviar(ctx, c, s);
          } catch (e) {
            ctx.log?.(`mídia do bloco ${n.id} falhou: ${(e as Error).message}`);
            await ctx.store.avisarDono(c, `Uma ${item.tipo === "imagem" ? "imagem" : item.tipo === "video" ? "vídeo" : "mídia de áudio"} do bloco “${n.id}” não foi enviada para {nome} (${(e as Error).message.slice(0, 120)}). O funil seguiu sem ela.`.replace("{nome}", c.nome ?? "o cliente"));
          }
        } else if (item.tipo === "voz") {
          // áudio com a voz clonada do dono; se falhar, manda o mesmo texto escrito (a conversa não trava)
          const t = preencher(item.texto ?? "", c).trim();
          if (t) {
            let url: string | null = null;
            try {
              url = ctx.voz ? await ctx.voz(c, t) : null;
            } catch (e) {
              ctx.log?.(`voz clonada falhou: ${(e as Error).message}`);
            }
            if (url) await enviar(ctx, c, { tipo: "audio", url, esperaMs: espera });
            else {
              // sem áudio: manda escrito, sem as etiquetas de emoção ([risos]…)
              const escrito = t.replace(/\[[^\]\n]{1,40}\]\s*/g, "").replace(/[ \t]{2,}/g, " ").trim();
              if (escrito) await enviar(ctx, c, { tipo: "texto", texto: escrito, esperaMs: espera });
            }
          }
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

    // Order bump (antes do Pix: "leva junto?") e Downsell (oferta mais barata para quem recusou)
    case "orderbump":
    case "downsell": {
      const oferta = cfg.produtoId ? await ctx.store.produto(String(cfg.produtoId)) : null;
      const extra: Record<string, string> = oferta ? { produto: oferta.nome, preco: brl(oferta.preco_centavos) } : {};
      if (n.data.tipo === "orderbump") {
        // tira um bump antigo antes de oferecer de novo
        if (c.campos.__bump) {
          const campos = { ...c.campos };
          delete campos.__bump;
          await patch(ctx, c, { campos });
        }
      }
      await enviarTexto(ctx, c, preencher(cfg.texto ?? "", c, extra));
      return esperarResposta(ctx, c, n, "upsell", minutos(cfg.esperarMin, 15));
    }

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
      // order bump aceito antes deste Pix: soma no mesmo Pix (vale também para o Pix gerado de novo depois de expirar)
      const bumpId = tipoPix === "principal" && c.campos.__bump ? String(c.campos.__bump) : null;
      const bump = bumpId && bumpId !== produto.id ? await ctx.store.produto(bumpId) : null;
      const cobrado: Produto = bump ? { ...produto, nome: `${produto.nome} + ${bump.nome}`, preco_centavos: produto.preco_centavos + bump.preco_centavos } : produto;
      // dois jeitos de cobrar: "asaas" (copia e cola, confirma sozinho) ou "chave" (botão de Pix do WhatsApp com a sua chave de outro banco; a IA confere o comprovante)
      const chaveWpp = String(cfg.chaveWhatsApp ?? "").trim();
      const modoChave = cfg.modoPix === "chave" && Boolean(chaveWpp);
      let pix: Awaited<ReturnType<Store["criarPix"]>>;
      try {
        pix = await ctx.store.criarPix(c, cobrado, expira, tipoPix, modoChave);
      } catch (e) {
        // não deixa o cliente sem resposta: avisa, passa para humano e alerta o dono
        ctx.log?.(`falha ao gerar Pix: ${(e as Error).message}`);
        await enviarTexto(ctx, c, "Só um instante, já te mando o Pix 🙏");
        await patch(ctx, c, { robo_ativo: false });
        await ctx.store.avisarDono(
          c,
          `Não consegui gerar o Pix de ${brl(cobrado.preco_centavos)} para {nome} ({telefone}): ${(e as Error).message}. O robô pausou nessa conversa — mande o Pix manualmente em Conversas.`.replace("{nome}", c.nome ?? "o cliente").replace("{telefone}", c.telefone),
        );
        return { parar: true, finalizar: true };
      }
      await enviarTexto(ctx, c, preencher(cfg.texto || "Aqui está o seu Pix de {preco} 👇", c, { produto: cobrado.nome, preco: brl(cobrado.preco_centavos) }));
      if (modoChave) {
        try {
          await enviar(ctx, c, {
            tipo: "botao_pix",
            titulo: `💠 Pix de ${brl(cobrado.preco_centavos)}`,
            texto: `${cobrado.nome} · valor: ${brl(cobrado.preco_centavos)}`,
            chave: chaveWpp,
            tipoChave: tipoDaChave(chaveWpp),
            nome: String(cfg.nomeRecebedor || cobrado.nome).slice(0, 25),
            rodape: "Depois de pagar, me manda o comprovante aqui 🙏",
            esperaMs: 800,
          });
          // o WhatsApp não mostra o botão em todo celular (e não avisa quando some): a chave vai escrita também
          if (cfg.chaveEmTexto !== false) await enviar(ctx, c, { tipo: "texto", texto: `Se o botão não aparecer aí, a chave Pix (${NOME_TIPO_CHAVE[tipoDaChave(chaveWpp)]}) é:`, esperaMs: 1500 });
          if (cfg.chaveEmTexto !== false) await enviar(ctx, c, { tipo: "texto", texto: chaveWpp, esperaMs: 900 });
        } catch (e) {
          // botão não saiu: manda a chave escrita
          ctx.log?.(`botão de Pix do WhatsApp falhou, mandando a chave em texto: ${(e as Error).message}`);
          await enviar(ctx, c, { tipo: "texto", texto: `Chave Pix (${NOME_TIPO_CHAVE[tipoDaChave(chaveWpp)]}) para pagar *${brl(cobrado.preco_centavos)}* 👇`, esperaMs: 800 });
          await enviar(ctx, c, { tipo: "texto", texto: chaveWpp, esperaMs: 900 });
        }
        await patch(ctx, c, { campos: { ...c.campos, __chave_pix: ctx.store.agora().toISOString(), __pediu_comprovante: "" } });
      } else if (pix.link) {
        // gateway de link (LivePix): a página tem o Pix copia e cola e o QR Code
        await enviar(ctx, c, { tipo: "texto", texto: `👉 Toque no link para abrir o Pix (o código *copia e cola* e o QR Code estão lá):\n${pix.link}`, esperaMs: 800 });
      } else {
        let foiBotao = false;
        if (cfg.botaoCopiar) {
          // botão "📋 Copiar código Pix": o cliente toca e cola no banco (o código é o mesmo do gateway, a confirmação continua automática)
          try {
            await enviar(ctx, c, {
              tipo: "botao_copiar",
              titulo: `💠 Pix de ${brl(cobrado.preco_centavos)}`,
              texto: cobrado.nome,
              codigo: pix.copiaCola,
              rotulo: "Copiar código Pix",
              rodape: "Toque no botão, abra o app do banco e cole em Pix copia e cola",
              esperaMs: 800,
            });
            foiBotao = true;
          } catch (e) {
            ctx.log?.(`botão do Pix falhou, mandando só o código: ${(e as Error).message}`);
          }
        }
        // o código em texto vai sempre (ou como reserva, se o botão não aparecer no aparelho do cliente)
        if (!foiBotao || cfg.codigoTambem !== false) await enviar(ctx, c, { tipo: "texto", texto: pix.copiaCola, esperaMs: foiBotao ? 1200 : 800 });
      }
      await patch(ctx, c, { pix_ativo: { bloco: n.id, pagamento_id: pix.id, funil_id: funil.id, tipo: tipoPix, bump: bump?.id ?? null } });
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
export type OpcoesMensagem = {
  /** a mensagem chegou enquanto o robô ainda mandava a sequência anterior (provavelmente era sobre o passo de antes) */
  atrasada?: boolean;
};

export async function receberMensagem(ctx: Ctx, c: Contato, funilPadrao: () => Promise<Funil | null>, texto: string, op: OpcoesMensagem = {}) {
  if (!c.ja_respondeu && (c.bloco_atual || c.finalizado)) {
    await patch(ctx, c, { ja_respondeu: true });
    await evento(ctx, c, "respondeu");
  }
  if (!c.robo_ativo) return;

  // primeira mensagem (ou funil ainda não começou)
  if (!c.funil_id || (!c.bloco_atual && !c.finalizado)) {
    const f = (c.funil_id && (await ctx.store.funil(c.funil_id))) || (await funilPadrao());
    if (f) await iniciar(ctx, c, f, op.atrasada ? "" : texto);
    return;
  }

  // funil terminou e o cliente voltou a falar: recomeça se ele ainda não comprou
  // ou se o funil dele foi pausado/apagado (você trocou de funil)
  if (c.finalizado && !c.aguardando && !c.pix_ativo) {
    const atual = await ctx.store.funil(c.funil_id);
    if (!atual || atual.ativo === false || !(await ctx.store.jaComprou(c))) {
      const f = await funilPadrao();
      if (f) await iniciar(ctx, c, f, texto);
      return;
    }
  }

  const funil = await ctx.store.funil(c.funil_id);
  if (!funil) return;
  const ag = c.aguardando;
  if (!ag) {
    // aguardando o pagamento do Pix: responde a dúvida em vez de ficar mudo
    if (c.pix_ativo && !op.atrasada) await duvidaComPixAberto(ctx, c, funil, texto);
    return;
  }
  const n = no(funil, ag.bloco);
  if (!n) return;
  const cfg = n.data.config ?? {};

  const seguir = async (saida: string) => {
    await ctx.store.cancelarAgendamentos(c, ["timeout", "esperar"]);
    await ctx.store.registrarExecucao(c, funil.id, n.id, saida);
    await patch(ctx, c, { aguardando: null });
    await executarDesde(ctx, c, funil, proximo(funil, n.id, saida), texto);
  };
  const repetir = async (msg: string, extra: Partial<Aguardando> = {}) => {
    await enviarTexto(ctx, c, msg);
    await patch(ctx, c, { aguardando: { ...ag, ...extra, tentativas: ag.tentativas + 1 } });
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
      if (i < 0) i = opcaoPorPalavra(texto, opcoes);
      if (i >= 0) return seguir(`opcao_${i}`);
      if (op.atrasada) return; // falou enquanto o robô ainda mandava a pergunta
      // já repetiu as opções uma vez: não insiste nem segue sozinho; se não escolher, o "Não respondeu" (lembretes) age no tempo dele
      if (ag.tentativas >= 1) return;
      const lista = opcoes.map((o, k) => `*${k + 1}.* ${o}`).join("\n");
      return repetir(ehReacao(texto) ? `🙏 Só pra eu te mostrar o certo, me conta: é pra onde?\n\n${lista}` : cfg.msgInvalida || `Me responde com o número da opção, tá? 🙂\n\n${lista}`);
    }

    case "objecoes": {
      const pergunta = querInformacao(texto);
      // Atendente IA na 1ª mensagem: a do anúncio vem pronta ("Quero o caderno fácil"), então a IA sempre explica antes de oferecer o Pix
      const primeiraDoAtendente = Boolean(ag.atendente) && ag.tentativas === 0 && Boolean(ctx.ia);
      if (!primeiraDoAtendente && !negou(texto) && !pergunta && (contemAlguma(texto, palavras(cfg.palavrasCompra)) || contemAlguma(semRepeticao(texto), palavras(cfg.palavrasCompra)))) return seguir("comprar");
      const obj = ((cfg.objecoes ?? []) as { palavras: string; resposta: string }[]).find((o) => contemAlguma(texto, palavras(o.palavras)));
      if (obj?.resposta && !primeiraDoAtendente) return repetir(obj.resposta);
      // com o Atendente IA, "oi"/"👍" também vai para a IA (ela conduz a conversa desde o começo)
      const reacao = !(ag.atendente && ctx.ia) && ehReacao(texto);
      // mensagem que chegou no meio da sequência e não diz nada novo: não responde fora de hora
      if (op.atrasada && (reacao || normalizar(texto).length < 15)) return;
      if (reacao) {
        if (ag.reacoes) return; // já deu o empurrãozinho: não fica repetindo
        return repetir(cfg.msgReacao || "🙏🙏 Quer que eu já gere seu Pix pra você receber agora?", { reacoes: 1 });
      }
      // a IA entende o que o cliente disse e responde de verdade
      if ((cfg.iaLigada || ag.atendente) && ctx.ia) {
        const r = await ctx.ia(c, configIAObjecoes(cfg, Boolean(ag.atendente)));
        if (!("erro" in r)) {
          await enviarRespostaIA(ctx, c, r.resposta, false);
          // a IA só fecha a venda se a mensagem do cliente for um aceite claro (pergunta/comentário nunca fecha)
          if (r.concluido && !primeiraDoAtendente && aceitou(texto, palavras(cfg.palavrasCompra))) return seguir("comprar");
          await patch(ctx, c, { aguardando: { ...ag, tentativas: ag.tentativas + 1 } });
          return;
        }
        ctx.log?.(`IA nas objeções falhou: ${r.erro}`);
      }
      if (cfg.naoEntendeu && !ag.padrao) return repetir(cfg.naoEntendeu, { padrao: 1 });
      return;
    }

    case "upsell": {
      const aceitou = !negou(texto) && contemAlguma(texto, palavras(cfg.palavrasSim));
      if (n.data.tipo === "orderbump" && aceitou && cfg.produtoId) await patch(ctx, c, { campos: { ...c.campos, __bump: String(cfg.produtoId) } });
      return seguir(aceitou ? "aceitou" : "recusou");
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
    // Pix pela chave do WhatsApp: antes dos lembretes, pede o comprovante (a IA confere quando chegar)
    if (tipo === "pix_nao_pagou" && c.campos.__chave_pix && !c.campos.__pediu_comprovante) {
      const cfgPix = no(funil, dados.bloco)?.data.config ?? {};
      await patch(ctx, c, { campos: { ...c.campos, __pediu_comprovante: "1" } });
      await enviarTexto(ctx, c, preencher(String(cfgPix.msgComprovante || MSG_COMPROVANTE), c));
      await ctx.store.agendar(c, "pix_nao_pagou", addMin(ctx.store.agora(), minutos(cfgPix.esperarComprovanteMin, 30)), dados);
      return;
    }
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
  // pagou: a conversa deixa de estar "esperando comprovante da chave"
  const camposPago = { ...c.campos };
  delete camposPago.__chave_pix;
  delete camposPago.__pediu_comprovante;
  await patch(ctx, c, { pix_ativo: null, aguardando: null, finalizado: false, campos: camposPago });
  const funil = await ctx.store.funil(ativo.funil_id);
  if (!funil) return;
  await patch(ctx, c, { funil_id: funil.id });
  await ctx.store.registrarExecucao(c, funil.id, ativo.bloco, "pagou");
  if (c.campos.__bump && ativo.tipo !== "upsell") {
    const campos = { ...c.campos };
    delete campos.__bump;
    await patch(ctx, c, { campos });
  }
  // entrega o order bump junto (o resto do funil entrega o produto principal)
  if (ativo.bump) {
    const bump = await ctx.store.produto(ativo.bump);
    if (bump) {
      await enviarTexto(ctx, c, preencher(bump.mensagem_entrega || "🎁 E aqui está o {produto} que você levou junto:", c, { produto: bump.nome, preco: brl(bump.preco_centavos) }));
      if (bump.entrega_conteudo) {
        if (bump.entrega_tipo === "arquivo") await enviar(ctx, c, { tipo: "arquivo", url: bump.entrega_conteudo, nome: bump.nome, esperaMs: 1000 });
        else await enviar(ctx, c, { tipo: "texto", texto: bump.entrega_conteudo, esperaMs: 1000 });
      }
    }
  }
  await executarDesde(ctx, c, funil, proximo(funil, ativo.bloco, "pagou"), "");
}


/* ------------------------------------------------------------------ */
/* Conversa mais esperta                                               */
/* ------------------------------------------------------------------ */

const PALAVRAS_VAZIAS = new Set(["na", "no", "em", "de", "do", "da", "pra", "para", "com", "o", "a", "os", "as", "um", "uma", "e", "ou", "meu", "minha"]);

/** "igreja" acha "Na igreja"; "grupo" acha "Na célula / grupo". */
export function opcaoPorPalavra(texto: string, opcoes: string[]) {
  const t = ` ${normalizar(texto).replace(/[^\p{L}\p{N}\s]/gu, " ")} `;
  const achadas = opcoes
    .map((o, i) => ({ i, hits: normalizar(o).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 4 && !PALAVRAS_VAZIAS.has(w)).filter((w) => t.includes(` ${w} `) || t.includes(` ${w.slice(0, -1)} `)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return achadas.length && (achadas.length === 1 || achadas[0].hits > achadas[1].hits) ? achadas[0].i : -1;
}

function configIAObjecoes(cfg: Config, atendente = false): Config {
  return {
    instrucoes: [
      cfg.iaInstrucoes || "Você é a pessoa que vende este produto no WhatsApp: simpática, acolhedora e direta.",
      atendente
        ? "Você atende este cliente desde a primeira mensagem (ele veio do anúncio). A primeira mensagem dele costuma ser automática do anúncio (ex.: \"Quero o caderno fácil\"), então NÃO trate como compra: na primeira resposta, cumprimente, explique o produto em poucas linhas (o que é, o que vem e o preço) e pergunte se ele quer que você já mande o Pix. Depois, responda exatamente o que ele disser, com naturalidade. Mensagens curtas, como no WhatsApp."
        : "Você está no meio da venda: o cliente já viu o produto e o preço. Responda exatamente o que ele disse, com naturalidade.",
      "Se fizer sentido, termine com uma pergunta curta convidando a gerar o Pix (sem repetir a mesma frase de antes).",
      "Se o cliente só comentou algo (um plano, uma ideia), valide e conecte com o produto.",
    ].join("\n"),
    conhecimento: cfg.iaConhecimento || "",
    objetivo: "o cliente dizer claramente que quer (ex.: \"sim\", \"quero\", \"pode mandar\", \"combinado\"). Pergunta, dúvida, comentário ou informação sobre ele NUNCA é aceite: nesses casos responda e pergunte se ele quer, com concluido false",
  };
}

/** Cliente escreveu com o Pix já enviado (sem bloco esperando resposta): tira a dúvida e lembra do Pix. */
async function duvidaComPixAberto(ctx: Ctx, c: Contato, funil: Funil, texto: string) {
  if (ehReacao(texto)) return;
  const usos = Number(c.campos.__ia_pix ?? 0);
  if (usos >= 6) return; // não vira bate-papo infinito: daí em diante é com você no Conversas
  await patch(ctx, c, { campos: { ...c.campos, __ia_pix: String(usos + 1) } });
  const obj = funil.grafo.nodes.find((n) => n.data.tipo === "objecoes")?.data.config ?? {};
  const resposta = ((obj.objecoes ?? []) as { palavras: string; resposta: string }[]).find((o) => contemAlguma(texto, palavras(o.palavras)))?.resposta;
  if (resposta) {
    await enviarTexto(ctx, c, resposta.replace(/\s*Posso gerar seu Pix\??/i, " Seu Pix está aqui em cima 👆"));
    return;
  }
  if (obj.iaLigada && ctx.ia) {
    const base = configIAObjecoes(obj);
    const r = await ctx.ia(c, {
      ...base,
      instrucoes: obj.contraEntrega
        ? `${base.instrucoes}\nCONTRA ENTREGA: o cliente JÁ RECEBEU o produto aqui na conversa e combinou de pagar depois de conferir. O Pix JÁ FOI ENVIADO e está acima (código copia e cola). Não diga que vai gerar outro nem que o produto vai chegar. Responda a dúvida com gentileza e lembre do combinado: é só copiar o código do Pix aí em cima e pagar agora, leva 1 minutinho. NUNCA dê prazo nem diga \"quando puder\", \"sem pressa\" ou que o Pix vale por dias: incentive a pagar agora, com carinho e sem ser agressivo. Se disser que já pagou, agradeça e diga que a confirmação é automática.`
        : `${base.instrucoes}\nO Pix JÁ FOI ENVIADO e está acima na conversa (código copia e cola). Não diga que vai gerar outro. Responda a dúvida e, se fizer sentido, lembre que é só copiar o código do Pix aí em cima e que o produto chega sozinho assim que o pagamento cair. Se disser que já pagou, diga que a confirmação é automática e chega em instantes.`,
      objetivo: "tirar a dúvida e o cliente pagar o Pix que já está na conversa",
    });
    if (!("erro" in r)) {
      await enviarRespostaIA(ctx, c, r.resposta, false);
      return;
    }
    ctx.log?.(`IA com Pix aberto falhou: ${r.erro}`);
  }
  if (usos === 0)
    await enviarTexto(
      ctx,
      c,
      obj.contraEntrega
        ? "O Pix está aqui em cima 👆 É só copiar o código e colar no app do banco, leva 1 minutinho. Consegue fazer agora? 🙏"
        : "Seu Pix está aqui em cima 👆 É só copiar o código e colar no app do banco. Assim que cair, te mando tudo na hora 🙌",
    );
}
