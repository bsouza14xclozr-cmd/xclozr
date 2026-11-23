// Mascote do XClozr ("Clozi"): parado respira e pisca; trabalhando, digita no notebook.
// Desenho original em SVG, animado só com CSS (respeita "reduzir movimento").

export type EstadoMascote = "parado" | "trabalhando";
export type PapelMascote = "atendente" | "trafego";

const CSS = `
.mx{overflow:visible}
.mx-corpo,.mx-broto,.mx-olho,.mx-sombra,.mx-mao-e,.mx-mao-d,.mx-barra,.mx-ponto,.mx-tchau{transform-box:fill-box}
.mx-corpo{transform-origin:50% 100%;animation:mx-respira 3.2s ease-in-out infinite}
.mx-broto{transform-origin:50% 100%;animation:mx-balanca 2.6s ease-in-out infinite}
.mx-olho{transform-origin:50% 50%;animation:mx-pisca 4.6s infinite}
.mx-sombra{transform-origin:50% 50%;animation:mx-sombra 3.2s ease-in-out infinite}
.mx-trab .mx-corpo{animation-duration:1.6s}
.mx-mao-e{transform-origin:50% 0%;animation:mx-digita .34s ease-in-out infinite alternate}
.mx-mao-d{transform-origin:50% 0%;animation:mx-digita .34s ease-in-out -.17s infinite alternate}
.mx-brilho{animation:mx-tela 1.4s ease-in-out infinite}
.mx-barra{transform-origin:50% 100%;animation:mx-barra 1.2s ease-in-out infinite}
.mx-barra:nth-child(2){animation-delay:.2s}.mx-barra:nth-child(3){animation-delay:.4s}
.mx-ponto{animation:mx-ponto 1.2s ease-in-out infinite}
.mx-ponto:nth-child(2){animation-delay:.18s}.mx-ponto:nth-child(3){animation-delay:.36s}
.mx-tchau{transform-origin:15% 85%;animation:mx-tchau 6s ease-in-out infinite}
@keyframes mx-respira{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(-3px) scale(1.012,.99)}}
@keyframes mx-balanca{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}
@keyframes mx-pisca{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes mx-sombra{0%,100%{transform:scale(1)}50%{transform:scale(.93)}}
@keyframes mx-digita{from{transform:translateY(0)}to{transform:translateY(4px)}}
@keyframes mx-tela{0%,100%{opacity:.35}50%{opacity:.6}}
@keyframes mx-barra{0%,100%{transform:scaleY(.45)}50%{transform:scaleY(1)}}
@keyframes mx-ponto{0%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
@keyframes mx-tchau{0%,80%,100%{transform:rotate(0)}84%,92%{transform:rotate(-22deg)}88%,96%{transform:rotate(8deg)}}
@media (prefers-reduced-motion:reduce){.mx *{animation:none!important}}
`;

export function Mascote({
  estado = "parado",
  papel = "atendente",
  tamanho = 96,
  className = "",
  rotulo,
}: {
  estado?: EstadoMascote;
  papel?: PapelMascote;
  tamanho?: number;
  className?: string;
  rotulo?: string;
}) {
  const trab = estado === "trabalhando";
  const id = `mx${papel}${trab ? "t" : "p"}`;
  return (
    <svg
      viewBox="0 0 200 200"
      width={tamanho}
      height={tamanho}
      role="img"
      aria-label={rotulo ?? (trab ? "Mascote trabalhando no notebook" : "Mascote do XClozr")}
      className={`mx ${trab ? "mx-trab" : ""} ${className}`}
    >
      <style>{CSS}</style>
      <defs>
        <radialGradient id={`${id}-pele`} cx="38%" cy="30%" r="80%">
          <stop offset="0" stopColor="#b9f5cf" />
          <stop offset=".55" stopColor="#6fdc98" />
          <stop offset="1" stopColor="#2fae64" />
        </radialGradient>
        <linearGradient id={`${id}-note`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3f4b" />
          <stop offset="1" stopColor="#23262e" />
        </linearGradient>
        <radialGradient id={`${id}-luz`} cx="50%" cy="100%" r="70%">
          <stop offset="0" stopColor="#d9ffe8" />
          <stop offset="1" stopColor="#d9ffe8" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* sombra no chão */}
      <ellipse className="mx-sombra" cx="100" cy="186" rx="52" ry="7" fill="#000" opacity=".22" />

      <g className="mx-corpo">
        {/* pezinhos */}
        <ellipse cx="78" cy="178" rx="15" ry="8" fill="#2a9d5a" />
        <ellipse cx="122" cy="178" rx="15" ry="8" fill="#2a9d5a" />

        {/* broto na cabeça */}
        <g className="mx-broto">
          <path d="M100 52 C100 42 101 36 103 30" stroke="#2a9d5a" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M103 31 C112 20 126 22 128 26 C122 34 110 36 103 31Z" fill="#8ee6ad" stroke="#2a9d5a" strokeWidth="2" />
          <path d="M102 36 C94 27 82 28 80 32 C86 39 96 40 102 36Z" fill="#6fdc98" stroke="#2a9d5a" strokeWidth="2" />
        </g>

        {/* corpo */}
        <path d="M100 50 C146 50 166 86 166 122 C166 158 138 182 100 182 C62 182 34 158 34 122 C34 86 54 50 100 50Z" fill={`url(#${id}-pele)`} />
        <ellipse cx="100" cy="146" rx="38" ry="28" fill="#c9f7da" opacity=".55" />

        {/* luz da tela no rosto */}
        {trab && <ellipse className="mx-brilho" cx="100" cy="118" rx="58" ry="40" fill={`url(#${id}-luz)`} />}

        {/* olhos (olham para baixo quando digitam) */}
        <g transform={trab ? "translate(0 6)" : undefined}>
          <g className="mx-olho">
            <ellipse cx="78" cy="104" rx="9" ry="11.5" fill="#1b2330" />
            <circle cx="81" cy="99" r="3.4" fill="#fff" />
            <circle cx="75.5" cy="108" r="1.6" fill="#fff" opacity=".8" />
          </g>
          <g className="mx-olho">
            <ellipse cx="122" cy="104" rx="9" ry="11.5" fill="#1b2330" />
            <circle cx="125" cy="99" r="3.4" fill="#fff" />
            <circle cx="119.5" cy="108" r="1.6" fill="#fff" opacity=".8" />
          </g>
        </g>
        {/* bochechas e boca */}
        <ellipse cx="64" cy="124" rx="9" ry="5.5" fill="#ff8fa3" opacity=".55" />
        <ellipse cx="136" cy="124" rx="9" ry="5.5" fill="#ff8fa3" opacity=".55" />
        {trab ? (
          <path d="M94 128 Q100 131 106 128" stroke="#1b2330" strokeWidth="3" fill="none" strokeLinecap="round" />
        ) : (
          <path d="M91 122 Q100 132 109 122" stroke="#1b2330" strokeWidth="3.2" fill="none" strokeLinecap="round" />
        )}

        {/* acessório */}
        {papel === "atendente" ? (
          <g>
            <path d="M44 104 C44 62 156 62 156 104" stroke="#2b303a" strokeWidth="7" fill="none" strokeLinecap="round" />
            <rect x="34" y="96" width="16" height="26" rx="8" fill="#2b303a" />
            <rect x="150" y="96" width="16" height="26" rx="8" fill="#2b303a" />
            <rect x="38" y="101" width="8" height="16" rx="4" fill="#5ed98c" />
            <path d="M156 118 C156 136 140 140 120 136" stroke="#2b303a" strokeWidth="4" fill="none" strokeLinecap="round" />
            <circle cx="117" cy="135.5" r="5" fill="#2b303a" />
          </g>
        ) : trab ? null : (
          <g>
            <circle cx="100" cy="152" r="13" fill="#1b2330" />
            <path d="M92 157 L98 151 L102 154 L109 146" stroke="#5ed98c" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M104 146 L109 146 L109 151" stroke="#5ed98c" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}

        {trab ? (
          <g>
            {/* notebook (tampa virada pra gente) */}
            <path d="M58 150 L142 150 L150 186 L50 186Z" fill={`url(#${id}-note)`} />
            <rect x="46" y="184" width="108" height="7" rx="3" fill="#4a505d" />
            <circle cx="100" cy="168" r="6" fill="#5ed98c" opacity=".85" />
            {/* mãozinhas digitando */}
            <ellipse className="mx-mao-e" cx="72" cy="150" rx="11" ry="8" fill="#5fd18d" stroke="#2a9d5a" strokeWidth="2" />
            <ellipse className="mx-mao-d" cx="128" cy="150" rx="11" ry="8" fill="#5fd18d" stroke="#2a9d5a" strokeWidth="2" />
            {/* o que ele está fazendo */}
            {papel === "trafego" ? (
              <g transform="translate(150 40)">
                <rect x="-4" y="-6" width="40" height="34" rx="9" fill="#1b2330" opacity=".92" />
                <g>
                  <rect className="mx-barra" x="4" y="4" width="6" height="18" rx="2" fill="#5ed98c" />
                  <rect className="mx-barra" x="13" y="4" width="6" height="18" rx="2" fill="#8ee6ad" />
                  <rect className="mx-barra" x="22" y="4" width="6" height="18" rx="2" fill="#5ed98c" />
                </g>
              </g>
            ) : (
              <g transform="translate(146 40)">
                <path d="M0 0 h40 a8 8 0 0 1 8 8 v14 a8 8 0 0 1 -8 8 h-26 l-8 7 v-7 h-6 a8 8 0 0 1 -8 -8 v-14 a8 8 0 0 1 8 -8z" fill="#1b2330" opacity=".92" />
                <g>
                  <circle className="mx-ponto" cx="12" cy="15" r="3.6" fill="#5ed98c" />
                  <circle className="mx-ponto" cx="24" cy="15" r="3.6" fill="#5ed98c" />
                  <circle className="mx-ponto" cx="36" cy="15" r="3.6" fill="#5ed98c" />
                </g>
              </g>
            )}
          </g>
        ) : (
          <g>
            {/* bracinhos: um acena de vez em quando */}
            <ellipse cx="42" cy="138" rx="10" ry="15" fill="#5fd18d" stroke="#2a9d5a" strokeWidth="2" transform="rotate(18 42 138)" />
            <g className="mx-tchau">
              <ellipse cx="158" cy="138" rx="10" ry="15" fill="#5fd18d" stroke="#2a9d5a" strokeWidth="2" transform="rotate(-18 158 138)" />
            </g>
          </g>
        )}
      </g>
    </svg>
  );
}

/** Cartão de status do agente, no estilo "nome + ● conectado / está processando". */
export function CartaoAgente({
  nome,
  papel,
  estado,
  status,
  detalhe,
}: {
  nome: string;
  papel: PapelMascote;
  estado: EstadoMascote;
  status: string;
  detalhe?: string;
}) {
  const trab = estado === "trabalhando";
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-borda bg-cartao p-4">
      <div className="shrink-0 rounded-full bg-fundo p-1.5 ring-1 ring-borda">
        <Mascote estado={estado} papel={papel} tamanho={84} />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-lg font-semibold">{nome}</span>
        <span className={`flex items-center gap-2 text-sm ${trab ? "text-limao" : "text-suave"}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${trab ? "animate-pulse bg-limao" : "bg-limao/60"}`} />
          {status}
        </span>
        {detalhe && <span className="text-xs text-suave">{detalhe}</span>}
      </div>
    </div>
  );
}
