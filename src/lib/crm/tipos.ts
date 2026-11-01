export type Evento = "novo_contato" | "respondeu" | "pix_gerado" | "pagou" | "pix_expirou" | "upsell_aceito" | "humano";

export const EVENTOS: { valor: Evento; nome: string; descricao: string }[] = [
  { valor: "novo_contato", nome: "Novo contato", descricao: "quando alguém chama pela primeira vez" },
  { valor: "respondeu", nome: "Respondeu", descricao: "quando o cliente responde a primeira mensagem do robô" },
  { valor: "pix_gerado", nome: "Pix gerado", descricao: "quando o robô gera um Pix" },
  { valor: "pagou", nome: "Pagou", descricao: "quando o Pix é confirmado" },
  { valor: "pix_expirou", nome: "Pix expirou", descricao: "quando o Pix vence sem pagamento" },
  { valor: "upsell_aceito", nome: "Comprou o upsell", descricao: "quando aceita e paga o upsell" },
  { valor: "humano", nome: "Pediu humano", descricao: "quando o funil chama você" },
];

export type Coluna = { id: string; nome: string; cor: string; ordem: number; evento: Evento | null };
export type Etiqueta = { id: string; nome: string; cor: string };
export type TipoCampo = "texto" | "numero" | "email" | "data";
export type CampoPersonalizado = { id: string; chave: string; rotulo: string; tipo: TipoCampo };

export type Contato = {
  id: string;
  telefone: string;
  nome: string | null;
  etiquetas: string[];
  campos: Record<string, string>;
  kanban_coluna_id: string | null;
  notas: string | null;
  robo_ativo: boolean;
  criado_em: string;
  ultima_msg_em: string | null;
  anuncio_nome: string | null;
  total_pago_centavos: number;
  pix_pendente: boolean;
};

export type PatchContato = Partial<Pick<Contato, "nome" | "etiquetas" | "campos" | "kanban_coluna_id" | "notas" | "robo_ativo">>;

export const CORES = ["#6cb4ff", "#5ed98c", "#ffb04a", "#ff8a8a", "#c084fc", "#4fd1c5", "#facc15", "#f472b6", "#a3aab6"];

export const COLUNAS_PADRAO: Omit<Coluna, "id">[] = [
  { nome: "Novo lead", cor: "#6cb4ff", ordem: 0, evento: "novo_contato" },
  { nome: "Em conversa", cor: "#4fd1c5", ordem: 1, evento: "respondeu" },
  { nome: "Pix gerado", cor: "#ffb04a", ordem: 2, evento: "pix_gerado" },
  { nome: "Comprou", cor: "#5ed98c", ordem: 3, evento: "pagou" },
  { nome: "Comprou upsell", cor: "#c084fc", ordem: 4, evento: "upsell_aceito" },
  { nome: "Pix expirou", cor: "#ff8a8a", ordem: 5, evento: "pix_expirou" },
  { nome: "Precisa de você", cor: "#f472b6", ordem: 6, evento: "humano" },
];

export function nomeContato(c: Pick<Contato, "nome" | "telefone">) {
  return c.nome?.trim() || formatarTelefone(c.telefone);
}

export function formatarTelefone(t: string) {
  const d = t.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith("55")) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return t;
}

export function tempoRelativo(iso: string | null) {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

export function slugCampo(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
