"use client";

// Regras de entrada de um funil: quais conversas novas ele atende (campanha do Meta ou palavras da 1ª mensagem)
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Entrada = { campanhas?: string[]; anuncios?: string[]; palavras?: string };
type Campanha = { id: string; nome: string; status: string | null };

export function resumoEntrada(e: Entrada | null | undefined) {
  const partes: string[] = [];
  const c = e?.campanhas?.length ?? 0;
  const a = e?.anuncios?.length ?? 0;
  if (c) partes.push(`${c} campanha${c > 1 ? "s" : ""}`);
  if (a) partes.push(`${a} anúncio${a > 1 ? "s" : ""}`);
  const p = (e?.palavras ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (p.length) partes.push(`palavras: ${p.slice(0, 3).join(", ")}${p.length > 3 ? "…" : ""}`);
  return partes.join(" · ");
}

export function RegrasEntrada({
  funil,
  outros,
  onSalvo,
  onFechar,
}: {
  funil: { id: string; nome: string; ativo: boolean; padrao: boolean; entrada: Entrada | null };
  outros: { id: string; nome: string; entrada: Entrada | null }[];
  onSalvo: () => void;
  onFechar: () => void;
}) {
  const [campanhas, setCampanhas] = useState<Campanha[] | null>(null);
  const [marcadas, setMarcadas] = useState<string[]>(funil.entrada?.campanhas ?? []);
  const [palavras, setPalavras] = useState(funil.entrada?.palavras ?? "");
  const [ativar, setAtivar] = useState(funil.ativo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void createClient()
      .from("meta_campanhas")
      .select("id, nome, status")
      .order("atualizado_em", { ascending: false })
      .limit(200)
      .then(({ data }) => setCampanhas((data ?? []) as Campanha[]));
  }, []);

  // campanha já usada por outro funil: avisa (a primeira regra encontrada vence)
  const dono = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of outros) for (const c of o.entrada?.campanhas ?? []) m.set(c, o.nome);
    return m;
  }, [outros]);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    const entrada: Entrada = { ...(funil.entrada ?? {}), campanhas: marcadas, palavras: palavras.trim() };
    const { error } = await createClient().from("funis").update({ entrada, ativo: ativar }).eq("id", funil.id);
    setSalvando(false);
    if (error) return setErro("Não consegui salvar as regras.");
    onSalvo();
  }

  const temRegra = marcadas.length > 0 || palavras.trim().length > 0;

  return (
    <div className="flex w-full flex-col gap-4 rounded-xl border border-borda bg-fundo p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">🎯 Quem cai no funil “{funil.nome}”</span>
          <span className="text-xs text-suave">
            Conversa nova escolhe o funil nesta ordem: anúncio/campanha do Meta → palavras da primeira mensagem → funil padrão. Quem já está num funil continua nele.
          </span>
        </div>
        <button type="button" onClick={onFechar} aria-label="Fechar" className="text-suave hover:text-texto">
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-suave">Campanhas do Meta que mandam para este funil</span>
        {campanhas === null ? (
          <span className="text-xs text-suave">Carregando campanhas…</span>
        ) : campanhas.length === 0 ? (
          <span className="text-xs text-suave">Nenhuma campanha sincronizada. Conecte o Meta Ads em Anúncios.</span>
        ) : (
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-borda p-2">
            {campanhas.map((c) => {
              const on = marcadas.includes(c.id);
              const deOutro = dono.get(c.id);
              return (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-elevado">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#5ed98c]"
                      checked={on}
                      onChange={(e) => setMarcadas((m) => (e.target.checked ? [...m, c.id] : m.filter((x) => x !== c.id)))}
                    />
                    <span className="truncate">{c.nome}</span>
                    <span className={`shrink-0 text-[11px] ${c.status === "ACTIVE" ? "text-limao" : "text-suave"}`}>{c.status === "ACTIVE" ? "ativa" : "pausada"}</span>
                    {deOutro && <span className="shrink-0 text-[11px] text-laranja">já está em “{deOutro}”</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <label className="flex flex-col gap-1.5 text-[13px] text-suave">
        Palavras da primeira mensagem (separe por vírgula)
        <input
          value={palavras}
          onChange={(e) => setPalavras(e.target.value)}
          placeholder="Ex.: enem, prova, bíblico"
          className="min-h-11 rounded-[10px] border border-borda bg-cartao px-3 text-sm text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none"
        />
        <span className="text-[11px]">
          Vale para quem chama sem passar pelo anúncio (indicação, link na bio) e para a mensagem pronta do anúncio. Acento e maiúscula não importam. Se dois funis baterem, ganha o que tiver mais
          palavras encontradas.
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#5ed98c]" checked={ativar} onChange={(e) => setAtivar(e.target.checked)} />
        <span className="flex flex-col">
          Funil ligado (recebe conversas pelas regras)
          {!ativar && temRegra && <span className="text-xs text-laranja">Desligado, ele não recebe ninguém, mesmo com as regras.</span>}
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={salvando} onClick={() => void salvar()} className="min-h-10 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60">
          {salvando ? "Salvando…" : "Salvar regras"}
        </button>
        {funil.padrao && <span className="text-xs text-suave">Este é o funil padrão: além das regras, recebe quem não bater em nenhum outro.</span>}
        {erro && <span className="text-sm text-vermelho">{erro}</span>}
      </div>
    </div>
  );
}
