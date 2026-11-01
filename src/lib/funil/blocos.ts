/**
 * Catálogo de blocos do funil.
 * Cada bloco diz: quais campos aparecem no painel de configuração, quais saídas ele tem
 * e como resumir a configuração dentro do card no canvas.
 * O motor do robô (na VPS) vai ler este mesmo formato para executar o funil.
 */

export type TipoBloco =
  | "inicio"
  | "mensagem"
  | "pergunta"
  | "menu"
  | "condicao"
  | "acao"
  | "esperar"
  | "randomizador"
  | "ir_funil"
  | "pix"
  | "entregar"
  | "upsell"
  | "objecoes"
  | "humano"
  | "integracao"
  | "ia";

export type Config = Record<string, unknown>;

export type ItemMensagem =
  | { tipo: "texto"; texto: string }
  | { tipo: "imagem"; url: string; legenda: string }
  | { tipo: "video"; url: string; legenda: string }
  | { tipo: "audio"; url: string }
  | { tipo: "arquivo"; url: string; nome: string }
  | { tipo: "espera"; segundos: number; digitando: boolean };

export type Objecao = { palavras: string; resposta: string };

export type TipoAcao =
  | "etiqueta_add"
  | "etiqueta_remover"
  | "campo_definir"
  | "campo_limpar"
  | "kanban_mover"
  | "pausar_robo"
  | "notificar"
  | "encerrar";
export type Acao = { tipo: TipoAcao; valor: string; valor2?: string };

export type TipoRegra =
  | "mensagem"
  | "etiqueta"
  | "campo"
  | "horario"
  | "dia_semana"
  | "ja_comprou"
  | "pix_pendente"
  | "anuncio";
export type Regra = { tipo: TipoRegra; operador: string; valor: string; valor2?: string };

export type Campo =
  | { tipo: "texto"; chave: string; rotulo: string; placeholder?: string; dica?: string }
  | { tipo: "textarea"; chave: string; rotulo: string; placeholder?: string; dica?: string; variaveis?: boolean }
  | { tipo: "numero"; chave: string; rotulo: string; min?: number; sufixo?: string; dica?: string }
  | { tipo: "select"; chave: string; rotulo: string; opcoes: { valor: string; rotulo: string }[]; dica?: string }
  | { tipo: "booleano"; chave: string; rotulo: string; dica?: string }
  | { tipo: "lista"; chave: string; rotulo: string; placeholder?: string; dica?: string; comPeso?: boolean }
  | { tipo: "itens_mensagem"; chave: string; rotulo: string }
  | { tipo: "objecoes"; chave: string; rotulo: string }
  | { tipo: "acoes"; chave: string; rotulo: string }
  | { tipo: "regras"; chave: string; rotulo: string }
  | { tipo: "produto"; chave: string; rotulo: string; dica?: string }
  | { tipo: "funil"; chave: string; rotulo: string };

export type Saida = { id: string; rotulo: string; cor?: string };

export type Grupo = "mensagens" | "logica" | "venda" | "avancado";

export type BlocoDef = {
  tipo: TipoBloco;
  nome: string;
  descricao: string;
  cor: string;
  icone: string; // path SVG (viewBox 0 0 24 24)
  grupo: Grupo | null; // null = não aparece na paleta (bloco inicial)
  campos: Campo[];
  padrao: () => Config;
  saidas: (c: Config) => Saida[];
  resumo: (c: Config) => string;
};

export const GRUPOS: { id: Grupo; nome: string }[] = [
  { id: "mensagens", nome: "Mensagens" },
  { id: "venda", nome: "Venda X1" },
  { id: "logica", nome: "Lógica" },
  { id: "avancado", nome: "Avançado" },
];

const VERDE = "#5ed98c";
const VERMELHO = "#ff8a8a";
const LARANJA = "#ffb04a";
const CINZA = "#a3aab6";

const SEGUIR: Saida[] = [{ id: "seguir", rotulo: "Continuar" }];

function texto(c: Config, chave: string): string {
  const v = c[chave];
  return typeof v === "string" ? v : "";
}
function lista(c: Config, chave: string): string[] {
  const v = c[chave];
  return Array.isArray(v) ? (v as string[]) : [];
}
function corta(s: string, n = 70) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}
export function slugSaida(prefixo: string, i: number) {
  return `${prefixo}_${i}`;
}

export const OPCOES_ACAO: { valor: TipoAcao; rotulo: string; pede?: string; pede2?: string }[] = [
  { valor: "etiqueta_add", rotulo: "Adicionar etiqueta", pede: "Etiqueta" },
  { valor: "etiqueta_remover", rotulo: "Remover etiqueta", pede: "Etiqueta" },
  { valor: "campo_definir", rotulo: "Definir campo", pede: "Campo", pede2: "Valor" },
  { valor: "campo_limpar", rotulo: "Limpar campo", pede: "Campo" },
  { valor: "kanban_mover", rotulo: "Mover no Kanban", pede: "Coluna" },
  { valor: "pausar_robo", rotulo: "Pausar o robô nesta conversa", pede: "Por quantas horas" },
  { valor: "notificar", rotulo: "Me avisar no WhatsApp", pede: "Mensagem do aviso" },
  { valor: "encerrar", rotulo: "Encerrar o funil" },
];

export const OPCOES_REGRA: {
  valor: TipoRegra;
  rotulo: string;
  operadores: { valor: string; rotulo: string }[];
  pede?: string;
  pede2?: string;
}[] = [
  {
    valor: "mensagem",
    rotulo: "Mensagem do cliente",
    operadores: [
      { valor: "contem", rotulo: "contém" },
      { valor: "igual", rotulo: "é igual a" },
      { valor: "nao_contem", rotulo: "não contém" },
      { valor: "diferente", rotulo: "é diferente de" },
    ],
    pede: "Palavras (separe com vírgula)",
  },
  {
    valor: "etiqueta",
    rotulo: "Etiqueta",
    operadores: [
      { valor: "tem", rotulo: "tem" },
      { valor: "nao_tem", rotulo: "não tem" },
    ],
    pede: "Etiqueta",
  },
  {
    valor: "campo",
    rotulo: "Campo salvo",
    operadores: [
      { valor: "igual", rotulo: "é igual a" },
      { valor: "contem", rotulo: "contém" },
      { valor: "preenchido", rotulo: "está preenchido" },
      { valor: "vazio", rotulo: "está vazio" },
    ],
    pede: "Campo",
    pede2: "Valor",
  },
  {
    valor: "horario",
    rotulo: "Horário agora",
    operadores: [
      { valor: "entre", rotulo: "está entre" },
      { valor: "fora", rotulo: "está fora de" },
    ],
    pede: "Início (ex.: 08:00)",
    pede2: "Fim (ex.: 22:00)",
  },
  {
    valor: "dia_semana",
    rotulo: "Dia da semana",
    operadores: [
      { valor: "e", rotulo: "é" },
      { valor: "nao_e", rotulo: "não é" },
    ],
    pede: "Dias (ex.: sab, dom)",
  },
  {
    valor: "ja_comprou",
    rotulo: "Já comprou",
    operadores: [
      { valor: "sim", rotulo: "sim" },
      { valor: "nao", rotulo: "não" },
    ],
  },
  {
    valor: "pix_pendente",
    rotulo: "Tem Pix pendente",
    operadores: [
      { valor: "sim", rotulo: "sim" },
      { valor: "nao", rotulo: "não" },
    ],
  },
  {
    valor: "anuncio",
    rotulo: "Veio do anúncio",
    operadores: [
      { valor: "e", rotulo: "é" },
      { valor: "nao_e", rotulo: "não é" },
    ],
    pede: "Código de rastreio",
  },
];

export const BLOCOS: Record<TipoBloco, BlocoDef> = {
  inicio: {
    tipo: "inicio",
    nome: "Início",
    descricao: "O funil começa aqui quando o cliente manda a primeira mensagem.",
    cor: VERDE,
    icone: "M5 3l14 9-14 9V3z",
    grupo: null,
    campos: [],
    padrao: () => ({}),
    saidas: () => [{ id: "seguir", rotulo: "Começar" }],
    resumo: () => "Cliente chamou no WhatsApp",
  },

  mensagem: {
    tipo: "mensagem",
    nome: "Mensagem",
    descricao: "Envia textos, áudios, imagens, vídeos e arquivos, com espera e “digitando…” entre eles.",
    cor: "#6cb4ff",
    icone: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
    grupo: "mensagens",
    campos: [{ tipo: "itens_mensagem", chave: "itens", rotulo: "Conteúdo" }],
    padrao: () => ({ itens: [{ tipo: "texto", texto: "" }] satisfies ItemMensagem[] }),
    saidas: () => SEGUIR,
    resumo: (c) => {
      const itens = (c.itens as ItemMensagem[]) ?? [];
      if (!itens.length) return "Sem conteúdo";
      const primeiro = itens.find((i) => i.tipo === "texto") as { texto: string } | undefined;
      const extras = itens.filter((i) => i.tipo !== "texto" && i.tipo !== "espera").length;
      const base = primeiro?.texto ? corta(primeiro.texto) : "";
      return [base, extras ? `+ ${extras} mídia(s)` : ""].filter(Boolean).join(" ") || `${itens.length} item(ns)`;
    },
  },

  pergunta: {
    tipo: "pergunta",
    nome: "Pergunta",
    descricao: "Pergunta algo, espera a resposta e guarda num campo.",
    cor: "#b48cff",
    icone: "M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V15M12 18h.01",
    grupo: "mensagens",
    campos: [
      { tipo: "textarea", chave: "texto", rotulo: "Pergunta", placeholder: "Qual o seu nome?", variaveis: true },
      {
        tipo: "select",
        chave: "tipoResposta",
        rotulo: "Tipo de resposta",
        opcoes: [
          { valor: "texto", rotulo: "Texto (aceita áudio transcrito)" },
          { valor: "numero", rotulo: "Número" },
          { valor: "email", rotulo: "E-mail" },
          { valor: "qualquer", rotulo: "Qualquer coisa (texto, áudio, foto…)" },
        ],
      },
      { tipo: "texto", chave: "salvarEm", rotulo: "Salvar resposta no campo", placeholder: "nome", dica: "Use depois como {nome}" },
      { tipo: "numero", chave: "esperarMin", rotulo: "Esperar resposta por", min: 1, sufixo: "minutos" },
      { tipo: "textarea", chave: "msgInvalida", rotulo: "Mensagem se a resposta for inválida", placeholder: "Não entendi, pode repetir?" },
      { tipo: "numero", chave: "tentativas", rotulo: "Tentativas antes de desistir", min: 1 },
    ],
    padrao: () => ({ texto: "", tipoResposta: "texto", salvarEm: "", esperarMin: 60, msgInvalida: "", tentativas: 2 }),
    saidas: () => [
      { id: "respondeu", rotulo: "Respondeu", cor: VERDE },
      { id: "sem_resposta", rotulo: "Não respondeu", cor: LARANJA },
      { id: "invalida", rotulo: "Resposta inválida", cor: VERMELHO },
    ],
    resumo: (c) => corta(texto(c, "texto")) || "Configure a pergunta",
  },

  menu: {
    tipo: "menu",
    nome: "Menu de opções",
    descricao: "Mostra opções numeradas e segue o caminho da escolha.",
    cor: "#4fd1c5",
    icone: "M4 6h16M4 12h16M4 18h10",
    grupo: "mensagens",
    campos: [
      { tipo: "textarea", chave: "texto", rotulo: "Mensagem", placeholder: "Escolha uma opção:", variaveis: true },
      { tipo: "lista", chave: "opcoes", rotulo: "Opções", placeholder: "Nova opção" },
      { tipo: "textarea", chave: "msgInvalida", rotulo: "Mensagem se escolher errado", placeholder: "Responda só com o número da opção 🙂" },
      { tipo: "numero", chave: "esperarMin", rotulo: "Esperar resposta por", min: 1, sufixo: "minutos" },
    ],
    padrao: () => ({ texto: "", opcoes: ["Quero comprar", "Tenho uma dúvida"], msgInvalida: "", esperarMin: 60 }),
    saidas: (c) => [
      ...lista(c, "opcoes").map((o, i) => ({ id: slugSaida("opcao", i), rotulo: `${i + 1}. ${corta(o, 28) || "Opção"}` })),
      { id: "sem_resposta", rotulo: "Não respondeu", cor: LARANJA },
    ],
    resumo: (c) => corta(texto(c, "texto")) || `${lista(c, "opcoes").length} opções`,
  },

  objecoes: {
    tipo: "objecoes",
    nome: "Quebra de objeções",
    descricao: "Responde dúvidas comuns por palavra-chave e segue quando o cliente quiser comprar.",
    cor: LARANJA,
    icone: "M12 3l9 4v5c0 5-4 8-9 9-5-1-9-4-9-9V7l9-4z",
    grupo: "venda",
    campos: [
      { tipo: "texto", chave: "palavrasCompra", rotulo: "Palavras de quem quer comprar", placeholder: "quero, sim, pix, bora, manda" },
      { tipo: "objecoes", chave: "objecoes", rotulo: "Objeções e respostas" },
      { tipo: "textarea", chave: "naoEntendeu", rotulo: "Se não entender a mensagem", placeholder: "Posso te mandar o Pix agora?" },
      { tipo: "numero", chave: "esperarMin", rotulo: "Esperar resposta por", min: 1, sufixo: "minutos" },
    ],
    padrao: () => ({
      palavrasCompra: "quero, sim, pix, bora, manda, como pago",
      objecoes: [
        { palavras: "golpe, confiável, seguro", resposta: "" },
        { palavras: "caro, desconto, valor", resposta: "" },
      ] satisfies Objecao[],
      naoEntendeu: "",
      esperarMin: 120,
    }),
    saidas: () => [
      { id: "comprar", rotulo: "Quer comprar", cor: VERDE },
      { id: "sem_resposta", rotulo: "Não respondeu", cor: LARANJA },
    ],
    resumo: (c) => `${((c.objecoes as Objecao[]) ?? []).length} objeções configuradas`,
  },

  pix: {
    tipo: "pix",
    nome: "Gerar Pix",
    descricao: "Gera o Pix do produto, envia QR code + copia e cola e espera o pagamento.",
    cor: VERDE,
    icone: "M12 2l4 4-4 4-4-4 4-4zm0 12l4 4-4 4-4-4 4-4zM2 12l4-4 4 4-4 4-4-4zm12 0l4-4 4 4-4 4-4-4z",
    grupo: "venda",
    campos: [
      { tipo: "produto", chave: "produtoId", rotulo: "Produto" },
      { tipo: "textarea", chave: "texto", rotulo: "Mensagem junto do Pix", placeholder: "Aqui está seu Pix! Assim que pagar, te envio na hora.", variaveis: true },
      { tipo: "numero", chave: "esperarMin", rotulo: "Considerar “não pagou” depois de", min: 1, sufixo: "minutos", dica: "Use a saída “Não pagou ainda” para mandar lembretes." },
      { tipo: "numero", chave: "expiraMin", rotulo: "Pix expira em", min: 5, sufixo: "minutos" },
    ],
    padrao: () => ({ produtoId: "", texto: "", esperarMin: 15, expiraMin: 1440 }),
    saidas: () => [
      { id: "pagou", rotulo: "Pagou", cor: VERDE },
      { id: "nao_pagou", rotulo: "Não pagou ainda", cor: LARANJA },
      { id: "expirou", rotulo: "Pix expirou", cor: VERMELHO },
    ],
    resumo: (c) => (texto(c, "produtoId") ? "Pix do produto escolhido" : "Escolha o produto"),
  },

  entregar: {
    tipo: "entregar",
    nome: "Entregar produto",
    descricao: "Envia o acesso do produto (link, arquivo ou código).",
    cor: VERDE,
    icone: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8",
    grupo: "venda",
    campos: [
      { tipo: "produto", chave: "produtoId", rotulo: "Produto", dica: "Usa a entrega cadastrada em Produtos e Pix." },
      { tipo: "textarea", chave: "texto", rotulo: "Mensagem de entrega", placeholder: "Pagamento confirmado! Aqui está seu acesso:", variaveis: true },
    ],
    padrao: () => ({ produtoId: "", texto: "" }),
    saidas: () => SEGUIR,
    resumo: (c) => corta(texto(c, "texto")) || "Entrega do produto",
  },

  upsell: {
    tipo: "upsell",
    nome: "Upsell",
    descricao: "Oferece outro produto depois da compra.",
    cor: VERDE,
    icone: "M12 19V5M5 12l7-7 7 7",
    grupo: "venda",
    campos: [
      { tipo: "produto", chave: "produtoId", rotulo: "Produto oferecido" },
      { tipo: "textarea", chave: "texto", rotulo: "Mensagem da oferta", placeholder: "Quer levar também o … por só R$ …?", variaveis: true },
      { tipo: "texto", chave: "palavrasSim", rotulo: "Palavras de aceite", placeholder: "sim, quero, manda" },
      { tipo: "numero", chave: "esperarMin", rotulo: "Esperar resposta por", min: 1, sufixo: "minutos" },
    ],
    padrao: () => ({ produtoId: "", texto: "", palavrasSim: "sim, quero, manda, bora", esperarMin: 30 }),
    saidas: () => [
      { id: "aceitou", rotulo: "Aceitou", cor: VERDE },
      { id: "recusou", rotulo: "Recusou", cor: VERMELHO },
      { id: "sem_resposta", rotulo: "Não respondeu", cor: LARANJA },
    ],
    resumo: (c) => corta(texto(c, "texto")) || "Configure a oferta",
  },

  condicao: {
    tipo: "condicao",
    nome: "Condição",
    descricao: "Segue por caminhos diferentes conforme regras.",
    cor: "#f472b6",
    icone: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9",
    grupo: "logica",
    campos: [
      {
        tipo: "select",
        chave: "logica",
        rotulo: "Seguir por “Sim” quando",
        opcoes: [
          { valor: "todas", rotulo: "TODAS as regras forem verdadeiras" },
          { valor: "qualquer", rotulo: "QUALQUER regra for verdadeira" },
        ],
      },
      { tipo: "regras", chave: "regras", rotulo: "Regras" },
    ],
    padrao: () => ({ logica: "todas", regras: [] as Regra[] }),
    saidas: () => [
      { id: "sim", rotulo: "Sim", cor: VERDE },
      { id: "nao", rotulo: "Não", cor: VERMELHO },
    ],
    resumo: (c) => {
      const n = ((c.regras as Regra[]) ?? []).length;
      return n ? `${n} regra(s) · ${c.logica === "qualquer" ? "qualquer" : "todas"}` : "Adicione regras";
    },
  },

  acao: {
    tipo: "acao",
    nome: "Ação",
    descricao: "Etiqueta, salva campos, pausa o robô, te avisa ou encerra.",
    cor: "#facc15",
    icone: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
    grupo: "logica",
    campos: [{ tipo: "acoes", chave: "acoes", rotulo: "Ações" }],
    padrao: () => ({ acoes: [] as Acao[] }),
    saidas: () => SEGUIR,
    resumo: (c) => {
      const a = (c.acoes as Acao[]) ?? [];
      if (!a.length) return "Adicione ações";
      return a.map((x) => OPCOES_ACAO.find((o) => o.valor === x.tipo)?.rotulo ?? x.tipo).join(", ");
    },
  },

  esperar: {
    tipo: "esperar",
    nome: "Esperar",
    descricao: "Pausa o funil por um tempo antes de seguir.",
    cor: CINZA,
    icone: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
    grupo: "logica",
    campos: [
      { tipo: "numero", chave: "quantidade", rotulo: "Esperar", min: 1 },
      {
        tipo: "select",
        chave: "unidade",
        rotulo: "Unidade",
        opcoes: [
          { valor: "segundos", rotulo: "segundos" },
          { valor: "minutos", rotulo: "minutos" },
          { valor: "horas", rotulo: "horas" },
          { valor: "dias", rotulo: "dias" },
        ],
      },
      { tipo: "booleano", chave: "cancelaSeResponder", rotulo: "Cancelar a espera se o cliente responder" },
    ],
    padrao: () => ({ quantidade: 15, unidade: "minutos", cancelaSeResponder: false }),
    saidas: () => SEGUIR,
    resumo: (c) => `${c.quantidade ?? "?"} ${c.unidade ?? ""}`,
  },

  randomizador: {
    tipo: "randomizador",
    nome: "Teste A/B",
    descricao: "Divide os clientes entre caminhos para testar qual vende mais.",
    cor: "#a3e635",
    icone: "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
    grupo: "logica",
    campos: [
      { tipo: "lista", chave: "opcoes", rotulo: "Caminhos (com % de cada)", placeholder: "Novo caminho", comPeso: true },
    ],
    padrao: () => ({ opcoes: ["Caminho A", "Caminho B"], pesos: [50, 50] }),
    saidas: (c) => {
      const pesos = (c.pesos as number[]) ?? [];
      return lista(c, "opcoes").map((o, i) => ({ id: slugSaida("caminho", i), rotulo: `${corta(o, 22)} · ${pesos[i] ?? 0}%` }));
    },
    resumo: (c) => `${lista(c, "opcoes").length} caminhos`,
  },

  ir_funil: {
    tipo: "ir_funil",
    nome: "Ir para outro funil",
    descricao: "Continua o atendimento em outro funil.",
    cor: CINZA,
    icone: "M5 12h14M13 6l6 6-6 6",
    grupo: "logica",
    campos: [{ tipo: "funil", chave: "funilId", rotulo: "Funil" }],
    padrao: () => ({ funilId: "" }),
    saidas: () => [],
    resumo: (c) => (texto(c, "funilId") ? "Vai para o funil escolhido" : "Escolha o funil"),
  },

  humano: {
    tipo: "humano",
    nome: "Chamar humano",
    descricao: "Pausa o robô nesta conversa e te avisa para assumir.",
    cor: VERMELHO,
    icone: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
    grupo: "logica",
    campos: [
      { tipo: "textarea", chave: "texto", rotulo: "Mensagem para o cliente", placeholder: "Vou te passar para um atendente, só um instante!" },
      { tipo: "textarea", chave: "aviso", rotulo: "Aviso que você recebe", placeholder: "Cliente {nome} pediu atendimento" },
    ],
    padrao: () => ({ texto: "", aviso: "" }),
    saidas: () => [],
    resumo: (c) => corta(texto(c, "texto")) || "Passa para você",
  },

  integracao: {
    tipo: "integracao",
    nome: "Integração (webhook)",
    descricao: "Chama outro sistema e salva a resposta em campos.",
    cor: "#94a3b8",
    icone: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
    grupo: "avancado",
    campos: [
      {
        tipo: "select",
        chave: "metodo",
        rotulo: "Método",
        opcoes: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ valor: m, rotulo: m })),
      },
      { tipo: "texto", chave: "url", rotulo: "URL (https)", placeholder: "https://…" },
      { tipo: "textarea", chave: "headers", rotulo: "Headers (JSON)", placeholder: '{"Authorization": "Bearer …"}' },
      { tipo: "textarea", chave: "corpo", rotulo: "Corpo (JSON)", placeholder: '{"telefone": "{telefone}"}', variaveis: true },
      { tipo: "texto", chave: "salvarEm", rotulo: "Salvar resposta no campo", placeholder: "resposta_api" },
    ],
    padrao: () => ({ metodo: "POST", url: "", headers: "", corpo: "", salvarEm: "" }),
    saidas: () => [
      { id: "sucesso", rotulo: "Sucesso", cor: VERDE },
      { id: "erro", rotulo: "Erro", cor: VERMELHO },
    ],
    resumo: (c) => (texto(c, "url") ? `${c.metodo} ${corta(texto(c, "url"), 40)}` : "Configure a URL"),
  },

  ia: {
    tipo: "ia",
    nome: "Agente IA",
    descricao: "A IA conversa com o cliente usando as informações que você der. Tem custo por uso.",
    cor: "#c084fc",
    icone: "M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2L12 3z",
    grupo: "avancado",
    campos: [
      { tipo: "textarea", chave: "instrucoes", rotulo: "Quem é a IA e como deve agir", placeholder: "Você é a Ana, vendedora do [produto]. Seja simpática, responda curto…" },
      { tipo: "textarea", chave: "conhecimento", rotulo: "Informações do produto", placeholder: "Preço, o que inclui, garantia, como recebe…" },
      { tipo: "textarea", chave: "objetivo", rotulo: "Quando a IA termina", placeholder: "Quando o cliente disser que quer comprar" },
      { tipo: "numero", chave: "maxRespostas", rotulo: "Máximo de respostas da IA por cliente", min: 1, dica: "Controla o custo." },
      { tipo: "booleano", chave: "dividir", rotulo: "Dividir respostas longas em várias mensagens" },
    ],
    padrao: () => ({ instrucoes: "", conhecimento: "", objetivo: "", maxRespostas: 10, dividir: true }),
    saidas: () => [
      { id: "concluiu", rotulo: "Objetivo concluído", cor: VERDE },
      { id: "limite", rotulo: "Limite atingido", cor: LARANJA },
    ],
    resumo: (c) => corta(texto(c, "instrucoes")) || "Configure a IA",
  },
};

export const VARIAVEIS = ["{nome}", "{telefone}", "{produto}", "{preco}"];

export function blocoDe(tipo: string): BlocoDef {
  return BLOCOS[tipo as TipoBloco] ?? BLOCOS.mensagem;
}
