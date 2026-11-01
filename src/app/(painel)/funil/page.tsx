import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Funil" };

const etapas = [
  { nome: "Abertura", descricao: "primeira mensagem para quem chega" },
  { nome: "Apresentação", descricao: "texto, áudio ou vídeo do produto" },
  { nome: "Oferta", descricao: "preço e chamada para comprar" },
  { nome: "Pagamento (Pix)", descricao: "gerado automaticamente" },
  { nome: "Entrega", descricao: "quando o Pix cair" },
  { nome: "Upsell", descricao: "depois da compra" },
  { nome: "Recuperação", descricao: "lembretes de Pix não pago" },
];

export default function FunilPage() {
  return (
    <>
      <PageHeader title="Funil de venda" subtitle="Edite o que o robô fala em cada etapa" />

      <div className="flex flex-wrap items-start gap-4">
        <Card title="Etapas" className="min-w-0 flex-[1_1_260px]">
          <ol className="flex flex-col gap-1">
            {etapas.map((etapa, i) => (
              <li key={etapa.nome} className="flex items-center gap-3 rounded-[10px] p-3">
                <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-elevado text-xs font-bold">
                  {i + 1}
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">{etapa.nome}</span>
                  <span className="text-xs text-suave">{etapa.descricao}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Editor da etapa" className="min-w-0 flex-[2_1_460px]">
          <p className="text-sm text-suave">
            O editor de mensagens (texto, áudio, imagem, vídeo, espera) e as palavras-chave entram na Fase 3.
          </p>
        </Card>
      </div>
    </>
  );
}
