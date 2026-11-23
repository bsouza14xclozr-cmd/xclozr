// Regras de entrada: escolhe qual funil atende uma conversa nova.
import { contemAlguma, palavras } from "./motor.ts";

export type Entrada = { campanhas?: string[]; anuncios?: string[]; palavras?: string };
export type FunilEntrada = { id: string; padrao: boolean; entrada: Entrada | null };
export type Origem = { anuncio?: string | null; campanha?: string | null; texto?: string | null };

/**
 * Ordem: anúncio exato → campanha → palavras da 1ª mensagem → funil padrão.
 * Devolve também o motivo (aparece no log e ajuda a entender por que caiu ali).
 */
export function escolherFunil(funis: FunilEntrada[], o: Origem): { id: string; motivo: string } | null {
  if (!funis.length) return null;
  if (o.anuncio) {
    const f = funis.find((x) => x.entrada?.anuncios?.includes(o.anuncio!));
    if (f) return { id: f.id, motivo: "anúncio" };
  }
  if (o.campanha) {
    const f = funis.find((x) => x.entrada?.campanhas?.includes(o.campanha!));
    if (f) return { id: f.id, motivo: "campanha" };
  }
  const texto = (o.texto ?? "").trim();
  if (texto) {
    // o funil com mais palavras encontradas vence (empate: o padrão, depois a ordem da lista)
    let melhor: { f: FunilEntrada; n: number } | null = null;
    for (const f of funis) {
      const lista = palavras(f.entrada?.palavras);
      if (!lista.length) continue;
      const n = lista.filter((p) => contemAlguma(texto, [p])).length;
      if (n > 0 && (!melhor || n > melhor.n || (n === melhor.n && f.padrao && !melhor.f.padrao))) melhor = { f, n };
    }
    if (melhor) return { id: melhor.f.id, motivo: "palavra-chave" };
  }
  const padrao = funis.find((x) => x.padrao) ?? funis[0];
  return { id: padrao.id, motivo: "padrão" };
}
