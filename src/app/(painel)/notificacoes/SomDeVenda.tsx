"use client";

import { useEffect, useState } from "react";
import { ligarSom, somLigado, tocarSom } from "@/lib/som";

/** Liga/desliga o "cha-ching" de venda com o painel aberto e explica o limite do celular. */
export function SomDeVenda({ className }: { className: string }) {
  const [ligado, setLigado] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preferência salva neste aparelho
    setLigado(somLigado());
  }, []);

  return (
    <section className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">💸 Som de venda (cha-ching)</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-limao"
            checked={ligado}
            onChange={(e) => {
              ligarSom(e.target.checked);
              setLigado(e.target.checked);
              if (e.target.checked) tocarSom("venda", true);
            }}
          />
          Tocar neste aparelho
        </label>
      </div>
      <p className="text-sm text-suave">
        Com o XClozr aberto (no computador ou no celular), cada venda aprovada toca um <b className="text-texto">cha-ching</b> de caixa registradora.
      </p>
      <button
        type="button"
        onClick={() => tocarSom("venda", true)}
        className="min-h-11 self-start rounded-[10px] border border-limao/50 px-4 text-sm font-semibold text-limao hover:bg-limao/10"
      >
        🔊 Ouvir o som
      </button>
      <p className="text-xs text-suave">
        Com o app fechado, quem avisa é a notificação do celular. Nela o iPhone e o Android só deixam o som padrão do aparelho: aplicativos instalados pelo navegador não podem
        escolher outro som.
      </p>
    </section>
  );
}
