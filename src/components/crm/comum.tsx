"use client";

import Link from "next/link";
import type { Etiqueta } from "@/lib/crm/tipos";

export const inputCls =
  "w-full min-h-10 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";
export const areaCls =
  "w-full rounded-[10px] border border-borda bg-fundo p-3 text-sm leading-relaxed text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";

export function EtiquetaChip({
  nome,
  etiquetas,
  ativa = true,
  onClick,
  pequeno,
}: {
  nome: string;
  etiquetas: Etiqueta[];
  ativa?: boolean;
  onClick?: () => void;
  pequeno?: boolean;
}) {
  const cor = etiquetas.find((e) => e.nome === nome)?.cor ?? "#a3aab6";
  const classe = `inline-flex items-center gap-1.5 rounded-full border font-medium ${pequeno ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"}`;
  const estilo = ativa
    ? { borderColor: `${cor}66`, background: `${cor}1f`, color: cor }
    : { borderColor: "#262b35", background: "transparent", color: "#a3aab6" };
  const conteudo = (
    <>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: ativa ? cor : "#a3aab6" }} />
      {nome}
    </>
  );
  return onClick ? (
    <button type="button" aria-pressed={ativa} onClick={onClick} className={`${classe} min-h-8`} style={estilo}>
      {conteudo}
    </button>
  ) : (
    <span className={classe} style={estilo}>
      {conteudo}
    </span>
  );
}

export function AbasCrm({ atual, aoVivo }: { atual: "kanban" | "contatos" | "configurar"; aoVivo: boolean }) {
  const abas = [
    { id: "kanban", nome: "Kanban", href: "/crm" },
    { id: "contatos", nome: "Contatos", href: "/crm/contatos" },
    { id: "configurar", nome: "Colunas, etiquetas e campos", href: "/crm/configurar" },
  ] as const;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Seções do CRM" className="flex flex-wrap gap-1 rounded-xl border border-borda bg-cartao p-1">
        {abas.map((a) => (
          <Link
            key={a.id}
            href={a.href}
            aria-current={atual === a.id ? "page" : undefined}
            className={`flex min-h-10 items-center rounded-lg px-4 text-sm ${atual === a.id ? "bg-elevado font-semibold text-texto" : "text-suave hover:text-texto"}`}
          >
            {a.nome}
          </Link>
        ))}
      </nav>
      <span className="flex items-center gap-2 text-xs text-suave" role="status">
        <span className={`h-2 w-2 rounded-full ${aoVivo ? "bg-limao" : "bg-suave"}`} />
        {aoVivo ? "Atualizando ao vivo" : "Conectando…"}
      </span>
    </div>
  );
}
