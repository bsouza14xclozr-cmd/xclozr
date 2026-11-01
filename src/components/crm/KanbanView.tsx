"use client";

import { useMemo, useState, type DragEvent } from "react";
import { brl } from "@/lib/dinheiro";
import { EVENTOS, nomeContato, tempoRelativo, type Contato } from "@/lib/crm/tipos";
import type { Crm } from "@/lib/crm/useCrm";
import { AbasCrm, EtiquetaChip, inputCls } from "./comum";
import { FichaContato } from "./FichaContato";

type DadosKanban = Pick<Crm, "colunas" | "etiquetas" | "campos" | "contatos" | "carregando" | "erro" | "aoVivo" | "atualizarContato">;

function Cartao({ c, crm, onAbrir }: { c: Contato; crm: DadosKanban; onAbrir: () => void }) {
  return (
    <li
      draggable
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData("text/contato", c.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="cursor-grab rounded-xl border border-borda bg-cartao p-3 shadow-sm hover:border-[#3a404c] active:cursor-grabbing"
    >
      <button type="button" onClick={onAbrir} className="flex w-full flex-col gap-2 text-left">
        <span className="flex items-start justify-between gap-2">
          <span className="truncate text-sm font-semibold">{nomeContato(c)}</span>
          <span className="shrink-0 text-[11px] text-suave">{tempoRelativo(c.ultima_msg_em ?? c.criado_em)}</span>
        </span>
        {c.anuncio_nome && <span className="truncate text-[11px] text-suave">via {c.anuncio_nome}</span>}
        {c.etiquetas.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {c.etiquetas.slice(0, 4).map((n) => (
              <EtiquetaChip key={n} nome={n} etiquetas={crm.etiquetas} pequeno />
            ))}
          </span>
        )}
        <span className="flex items-center justify-between gap-2 text-[11px]">
          {c.total_pago_centavos > 0 ? <span className="font-semibold text-limao">{brl(c.total_pago_centavos)}</span> : <span className="text-suave">sem compras</span>}
          <span className="flex items-center gap-2">
            {c.pix_pendente && <span className="font-semibold text-laranja">Pix pendente</span>}
            {!c.robo_ativo && <span className="font-semibold text-vermelho">robô pausado</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

export function KanbanView({ crm }: { crm: DadosKanban }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroEtiqueta, setFiltroEtiqueta] = useState("");

  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return crm.contatos.filter(
      (c) =>
        (!b || nomeContato(c).toLowerCase().includes(b) || c.telefone.includes(b.replace(/\D/g, "") || "§")) &&
        (!filtroEtiqueta || c.etiquetas.includes(filtroEtiqueta)),
    );
  }, [crm.contatos, busca, filtroEtiqueta]);

  const semColuna = filtrados.filter((c) => !c.kanban_coluna_id || !crm.colunas.some((k) => k.id === c.kanban_coluna_id));
  const colunasVisiveis = [
    ...(semColuna.length ? [{ id: "", nome: "Sem coluna", cor: "#a3aab6", ordem: -1, evento: null }] : []),
    ...crm.colunas,
  ];
  const contatoAberto = crm.contatos.find((c) => c.id === aberto) ?? null;

  const soltar = (e: DragEvent, colunaId: string) => {
    e.preventDefault();
    setSobre(null);
    const id = e.dataTransfer.getData("text/contato");
    if (id) void crm.atualizarContato(id, { kanban_coluna_id: colunaId || null });
  };

  return (
    <>
      <header className="flex flex-col gap-1.5">
        <h1 className="font-titulo text-3xl font-bold tracking-tight">CRM</h1>
        <p className="text-sm text-suave">Os contatos mudam de coluna sozinhos conforme a conversa avança. Você também pode arrastar.</p>
      </header>

      <AbasCrm atual="kanban" aoVivo={crm.aoVivo} />

      <div className="flex flex-wrap gap-3">
        <label htmlFor="busca-kanban" className="sr-only">
          Buscar contato
        </label>
        <input id="busca-kanban" type="search" className={`${inputCls} max-w-xs`} placeholder="Buscar por nome ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label htmlFor="filtro-etiqueta" className="sr-only">
          Filtrar por etiqueta
        </label>
        <select id="filtro-etiqueta" className={`${inputCls} max-w-[220px]`} value={filtroEtiqueta} onChange={(e) => setFiltroEtiqueta(e.target.value)}>
          <option value="">Todas as etiquetas</option>
          {crm.etiquetas.map((e) => (
            <option key={e.id} value={e.nome}>
              {e.nome}
            </option>
          ))}
        </select>
      </div>

      {crm.erro && <p className="text-sm text-vermelho">{crm.erro}</p>}
      {crm.carregando && <p className="text-sm text-suave">Carregando…</p>}

      {!crm.carregando && (
        <div className="-mx-5 overflow-x-auto px-5 pb-4 md:-mx-10 md:px-10">
          <div className="flex min-w-max gap-4">
            {colunasVisiveis.map((col) => {
              const itens = col.id ? filtrados.filter((c) => c.kanban_coluna_id === col.id) : semColuna;
              const total = itens.reduce((s, c) => s + c.total_pago_centavos, 0);
              const evento = EVENTOS.find((e) => e.valor === col.evento);
              return (
                <section
                  key={col.id || "sem"}
                  aria-label={`Coluna ${col.nome}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setSobre(col.id || "sem");
                  }}
                  onDragLeave={() => setSobre(null)}
                  onDrop={(e) => soltar(e, col.id)}
                  className={`flex w-72 shrink-0 flex-col gap-3 rounded-2xl border p-3 transition ${
                    sobre === (col.id || "sem") ? "border-limao bg-limao-escuro/40" : "border-borda bg-lateral"
                  }`}
                >
                  <div className="flex flex-col gap-1 px-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="flex items-center gap-2 text-sm font-semibold">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.cor }} />
                        {col.nome}
                      </h2>
                      <span className="rounded-full bg-elevado px-2 py-0.5 text-[11px] font-semibold text-suave">{itens.length}</span>
                    </div>
                    <span className="text-[11px] text-suave">
                      {evento ? `Automático: ${evento.nome.toLowerCase()}` : "Manual"}
                      {total > 0 && <> · {brl(total)}</>}
                    </span>
                  </div>
                  <ul className="flex min-h-24 flex-col gap-2">
                    {itens.map((c) => (
                      <Cartao key={c.id} c={c} crm={crm} onAbrir={() => setAberto(c.id)} />
                    ))}
                    {itens.length === 0 && <li className="rounded-xl border border-dashed border-borda p-4 text-center text-xs text-suave">Arraste contatos para cá</li>}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {!crm.carregando && crm.contatos.length === 0 && (
        <p className="text-sm text-suave">
          Ainda não há contatos. Quando o robô começar a atender, cada cliente aparece aqui na hora e vai mudando de coluna sozinho.
        </p>
      )}

      {contatoAberto && (
        <FichaContato
          key={contatoAberto.id}
          contato={contatoAberto}
          colunas={crm.colunas}
          etiquetas={crm.etiquetas}
          campos={crm.campos}
          onAtualizar={(p) => void crm.atualizarContato(contatoAberto.id, p)}
          onFechar={() => setAberto(null)}
        />
      )}
    </>
  );
}
