"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Aviso = { id: string; tipo: string; texto: string; link: string | null; lido: boolean; criado_em: string };

const ICONE: Record<string, string> = { venda: "💰", humano: "🙋", chip: "📵", funil: "⚠️", info: "🔔", trafego: "📈" };

function quando(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function Sininho() {
  const router = useRouter();
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    const { data } = await createClient().from("avisos").select("id, tipo, texto, link, lido, criado_em").order("criado_em", { ascending: false }).limit(40);
    if (data) setAvisos(data as Aviso[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega os avisos ao abrir o painel
    void carregar();
    const supabase = createClient();
    const canal = supabase
      .channel("avisos")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "avisos" }, (p) => {
        setAvisos((as) => [p.new as Aviso, ...as].slice(0, 40));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [carregar]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const naoLidos = avisos.filter((a) => !a.lido).length;

  async function abrirAviso(a: Aviso) {
    setAberto(false);
    if (!a.lido) {
      setAvisos((as) => as.map((x) => (x.id === a.id ? { ...x, lido: true } : x)));
      await createClient().from("avisos").update({ lido: true }).eq("id", a.id);
    }
    if (!a.link) return;
    // mesma página com outro ?parâmetro (ex.: /anuncios?aba=agente): recarrega para a tela ler o parâmetro
    if (a.link.includes("?") && a.link.split("?")[0] === window.location.pathname) window.location.assign(a.link);
    else router.push(a.link);
  }

  async function lerTodos() {
    const ids = avisos.filter((a) => !a.lido).map((a) => a.id);
    if (!ids.length) return;
    setAvisos((as) => as.map((x) => ({ ...x, lido: true })));
    await createClient().from("avisos").update({ lido: true }).in("id", ids);
  }

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-label={naoLidos ? `Avisos: ${naoLidos} não lido(s)` : "Avisos"}
        aria-expanded={aberto}
        className="relative flex h-10 w-10 items-center justify-center rounded-[10px] text-suave hover:bg-elevado hover:text-texto"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {naoLidos > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-vermelho px-1 text-[11px] font-bold text-white">
            {naoLidos > 9 ? "9+" : naoLidos}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute top-full right-0 z-50 mt-2 flex max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-borda bg-cartao shadow-2xl md:right-auto md:left-0">
          <div className="flex items-center justify-between border-b border-borda px-4 py-3">
            <span className="text-sm font-semibold">Avisos</span>
            {naoLidos > 0 && (
              <button type="button" onClick={lerTodos} className="text-xs text-limao hover:underline">
                Marcar todos como lidos
              </button>
            )}
          </div>
          <ul className="flex-1 overflow-y-auto">
            {avisos.length === 0 && <li className="px-4 py-8 text-center text-sm text-suave">Nenhum aviso por enquanto.</li>}
            {avisos.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => abrirAviso(a)}
                  className={`flex w-full gap-3 border-b border-borda/60 px-4 py-3 text-left text-sm hover:bg-elevado ${a.lido ? "text-suave" : "text-texto"}`}
                >
                  <span aria-hidden className="text-base leading-5">
                    {ICONE[a.tipo] ?? ICONE.info}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="leading-snug">{a.texto}</span>
                    <span className="text-[11px] text-suave">{quando(a.criado_em)}</span>
                  </span>
                  {!a.lido && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-limao" aria-label="não lido" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
