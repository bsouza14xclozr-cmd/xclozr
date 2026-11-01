"use client";

import { useMemo, useState } from "react";
import { brl } from "@/lib/dinheiro";
import { formatarTelefone, nomeContato, tempoRelativo } from "@/lib/crm/tipos";
import type { Crm } from "@/lib/crm/useCrm";
import { AbasCrm, EtiquetaChip, inputCls } from "./comum";
import { FichaContato } from "./FichaContato";

type DadosContatos = Pick<Crm, "colunas" | "etiquetas" | "campos" | "contatos" | "carregando" | "erro" | "aoVivo" | "atualizarContato">;

export function ContatosView({ crm }: { crm: DadosContatos }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [etiqueta, setEtiqueta] = useState("");
  const [coluna, setColuna] = useState("");
  const [compra, setCompra] = useState<"" | "comprou" | "nao" | "pendente">("");

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const digitos = b.replace(/\D/g, "");
    return crm.contatos.filter(
      (c) =>
        (!b || nomeContato(c).toLowerCase().includes(b) || (digitos && c.telefone.includes(digitos)) || Object.values(c.campos).some((v) => String(v).toLowerCase().includes(b))) &&
        (!etiqueta || c.etiquetas.includes(etiqueta)) &&
        (!coluna || c.kanban_coluna_id === coluna) &&
        (!compra || (compra === "comprou" ? c.total_pago_centavos > 0 : compra === "nao" ? c.total_pago_centavos === 0 : c.pix_pendente)),
    );
  }, [crm.contatos, busca, etiqueta, coluna, compra]);

  const contatoAberto = crm.contatos.find((c) => c.id === aberto) ?? null;
  const nomeColuna = (id: string | null) => crm.colunas.find((k) => k.id === id);

  return (
    <>
      <header className="flex flex-col gap-1.5">
        <h1 className="font-titulo text-3xl font-bold tracking-tight">CRM</h1>
        <p className="text-sm text-suave">Todos os seus contatos, com etiquetas e informações preenchidas pelo robô.</p>
      </header>

      <AbasCrm atual="contatos" aoVivo={crm.aoVivo} />

      <div className="flex flex-wrap gap-3">
        <label htmlFor="busca-contatos" className="sr-only">
          Buscar
        </label>
        <input id="busca-contatos" type="search" className={`${inputCls} max-w-xs`} placeholder="Nome, telefone ou informação" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label htmlFor="f-etiqueta" className="sr-only">
          Etiqueta
        </label>
        <select id="f-etiqueta" className={`${inputCls} max-w-[200px]`} value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)}>
          <option value="">Todas as etiquetas</option>
          {crm.etiquetas.map((e) => (
            <option key={e.id} value={e.nome}>
              {e.nome}
            </option>
          ))}
        </select>
        <label htmlFor="f-coluna" className="sr-only">
          Coluna
        </label>
        <select id="f-coluna" className={`${inputCls} max-w-[200px]`} value={coluna} onChange={(e) => setColuna(e.target.value)}>
          <option value="">Todas as colunas</option>
          {crm.colunas.map((k) => (
            <option key={k.id} value={k.id}>
              {k.nome}
            </option>
          ))}
        </select>
        <label htmlFor="f-compra" className="sr-only">
          Compras
        </label>
        <select id="f-compra" className={`${inputCls} max-w-[200px]`} value={compra} onChange={(e) => setCompra(e.target.value as typeof compra)}>
          <option value="">Compras: todos</option>
          <option value="comprou">Já compraram</option>
          <option value="nao">Ainda não compraram</option>
          <option value="pendente">Com Pix pendente</option>
        </select>
      </div>

      {crm.erro && <p className="text-sm text-vermelho">{crm.erro}</p>}

      <section className="rounded-2xl border border-borda bg-cartao">
        <div className="flex items-center justify-between border-b border-borda px-5 py-3">
          <h2 className="text-sm font-semibold">{lista.length} contato(s)</h2>
        </div>
        {crm.carregando ? (
          <p className="p-5 text-sm text-suave">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="p-5 text-sm text-suave">{crm.contatos.length === 0 ? "Ainda não há contatos. Eles aparecem aqui quando o robô começar a atender." : "Nenhum contato com esses filtros."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-suave">
                  <th className="px-5 py-3 font-medium">Contato</th>
                  <th className="px-3 py-3 font-medium">Coluna</th>
                  <th className="px-3 py-3 font-medium">Etiquetas</th>
                  <th className="px-3 py-3 font-medium">Origem</th>
                  <th className="px-3 py-3 font-medium">Comprou</th>
                  <th className="px-3 py-3 font-medium">Última msg</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => {
                  const col = nomeColuna(c.kanban_coluna_id);
                  return (
                    <tr key={c.id} className="border-t border-borda hover:bg-elevado/50">
                      <td className="px-5 py-3">
                        <button type="button" onClick={() => setAberto(c.id)} className="flex flex-col text-left hover:text-limao">
                          <span className="font-semibold">{nomeContato(c)}</span>
                          <span className="text-xs text-suave">{formatarTelefone(c.telefone)}</span>
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        {col ? (
                          <span className="flex items-center gap-2 text-xs">
                            <span className="h-2 w-2 rounded-full" style={{ background: col.cor }} />
                            {col.nome}
                          </span>
                        ) : (
                          <span className="text-xs text-suave">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex flex-wrap gap-1">
                          {c.etiquetas.map((n) => (
                            <EtiquetaChip key={n} nome={n} etiquetas={crm.etiquetas} pequeno />
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-suave">{c.anuncio_nome ?? "orgânico"}</td>
                      <td className="px-3 py-3 text-xs">
                        {c.total_pago_centavos > 0 ? <span className="font-semibold text-limao">{brl(c.total_pago_centavos)}</span> : c.pix_pendente ? <span className="text-laranja">Pix pendente</span> : <span className="text-suave">—</span>}
                      </td>
                      <td className="px-3 py-3 text-xs text-suave">{tempoRelativo(c.ultima_msg_em)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
