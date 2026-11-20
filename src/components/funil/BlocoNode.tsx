"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { blocoDe } from "@/lib/funil/blocos";
import type { NoBloco } from "@/lib/funil/grafo";
import { pct, useDesempenho } from "@/lib/funil/desempenho";

export function IconeBloco({ path, cor, tamanho = 16 }: { path: string; cor: string; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke={cor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function BlocoNodeBase({ id, data, selected }: NodeProps<NoBloco>) {
  const def = blocoDe(data.tipo);
  const des = useDesempenho();
  const est = des?.blocos[id];
  const saidas = def.saidas(data.config);
  const inicio = data.tipo === "inicio";

  return (
    <div
      className={`w-64 rounded-xl border bg-cartao text-texto shadow-lg transition ${
        selected ? "ring-2 ring-offset-0" : ""
      }`}
      style={{ borderColor: selected ? def.cor : "#262b35", ["--tw-ring-color" as string]: def.cor }}
    >
      {!inicio && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-3.5 !w-3.5 !border-2 !border-fundo !bg-suave"
          style={{ top: 22 }}
        />
      )}

      <div className="flex items-center gap-2 rounded-t-xl px-3 py-2.5" style={{ background: `${def.cor}1f` }}>
        <IconeBloco path={def.icone} cor={def.cor} />
        <span className="text-[13px] font-semibold">{def.nome}</span>
      </div>

      <p className="px-3 py-2.5 text-xs leading-relaxed text-suave">{def.resumo(data.config)}</p>

      {des && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-borda bg-fundo/60 px-3 py-2 text-[11px]">
          <span title="Pessoas que passaram por este bloco">
            👥 <b className="text-texto">{est?.passaram ?? 0}</b> <span className="text-suave">({pct(est?.passaram ?? 0, des.entraram)})</span>
          </span>
          {(est?.parados ?? 0) > 0 && (
            <span className="font-semibold text-laranja" title="Pessoas paradas neste bloco agora">
              ⏸ {est?.parados} parado{est?.parados === 1 ? "" : "s"} aqui
            </span>
          )}
        </div>
      )}

      {saidas.length > 0 && (
        <ul className="flex flex-col border-t border-borda py-1">
          {saidas.map((s) => (
            <li key={s.id} className="relative flex items-center justify-end px-3 py-1.5 text-[11px] font-medium" style={{ color: s.cor ?? "#edeff2" }}>
              {s.rotulo}
              {des && <span className="ml-1.5 rounded bg-elevado px-1.5 text-[10px] text-texto">{des.saidas[`${id}|${s.id}`] ?? 0}</span>}
              <Handle
                id={s.id}
                type="source"
                position={Position.Right}
                className="!h-3.5 !w-3.5 !border-2 !border-fundo"
                style={{ background: s.cor ?? "#5ed98c", right: -7 }}
              />
            </li>
          ))}
        </ul>
      )}
      {saidas.length === 0 && !inicio && (
        <p className="border-t border-borda px-3 py-1.5 text-[11px] text-suave">Fim deste caminho</p>
      )}
    </div>
  );
}

export const BlocoNode = memo(BlocoNodeBase);
