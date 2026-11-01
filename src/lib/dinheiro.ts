/** Formata centavos como "R$ 19,90". */
export function brl(centavos: number | null | undefined): string {
  return ((centavos ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Converte o que a pessoa digitou ("19,90", "R$ 19.90", "19") em centavos. null se inválido. */
export function paraCentavos(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, "").trim();
  if (!limpo) return null;
  // "1.234,56" → "1234.56"; "19,9" → "19.9"; "19.90" → "19.90"
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normal);
  if (!Number.isFinite(valor) || valor < 0) return null;
  return Math.round(valor * 100);
}

/** Centavos → texto para input ("19,90"). */
export function paraInput(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined) return "";
  return (centavos / 100).toFixed(2).replace(".", ",");
}
