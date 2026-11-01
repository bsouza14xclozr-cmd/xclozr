"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { CORES, EVENTOS, slugCampo, type Coluna, type Evento, type TipoCampo } from "@/lib/crm/tipos";
import type { Crm } from "@/lib/crm/useCrm";
import { AbasCrm, EtiquetaChip, inputCls } from "./comum";

type DadosConfig = Pick<
  Crm,
  "colunas" | "etiquetas" | "campos" | "carregando" | "erro" | "aoVivo" | "salvarColuna" | "apagarColuna" | "reordenarColunas" | "salvarEtiqueta" | "apagarEtiqueta" | "salvarCampo" | "apagarCampo"
>;

function SeletorCor({ valor, onChange, rotulo }: { valor: string; onChange: (c: string) => void; rotulo: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={rotulo}>
      {CORES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={valor === c}
          aria-label={`Cor ${c}`}
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full border-2 ${valor === c ? "border-texto" : "border-transparent"}`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

function LinhaColuna({
  col,
  indice,
  total,
  crm,
  onMover,
}: {
  col: Coluna;
  indice: number;
  total: number;
  crm: DadosConfig;
  onMover: (d: number) => void;
}) {
  const [nome, setNome] = useState(col.nome);
  const [confirmar, setConfirmar] = useState(false);
  const salvar = (patch: Partial<Coluna>) => void crm.salvarColuna({ ...col, nome, ...patch }, col.id);

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-borda bg-elevado p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: col.cor }} />
        <label htmlFor={`col-${col.id}`} className="sr-only">
          Nome da coluna
        </label>
        <input
          id={`col-${col.id}`}
          className={`${inputCls} max-w-[220px]`}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={() => nome.trim() && nome !== col.nome && salvar({ nome: nome.trim() })}
        />
        <label htmlFor={`ev-${col.id}`} className="sr-only">
          Evento automático
        </label>
        <select id={`ev-${col.id}`} className={`${inputCls} max-w-[260px]`} value={col.evento ?? ""} onChange={(e) => salvar({ evento: (e.target.value || null) as Evento | null })}>
          <option value="">Só manual</option>
          {EVENTOS.map((e) => (
            <option key={e.valor} value={e.valor}>
              Automático: {e.nome.toLowerCase()}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center">
          <button type="button" aria-label="Mover para a esquerda" disabled={indice === 0} onClick={() => onMover(-1)} className="h-9 w-9 rounded-lg text-suave hover:bg-cartao disabled:opacity-30">
            ↑
          </button>
          <button type="button" aria-label="Mover para a direita" disabled={indice === total - 1} onClick={() => onMover(1)} className="h-9 w-9 rounded-lg text-suave hover:bg-cartao disabled:opacity-30">
            ↓
          </button>
          {confirmar ? (
            <>
              <button type="button" onClick={() => void crm.apagarColuna(col.id)} className="min-h-9 px-2 text-xs font-semibold text-vermelho">
                Confirmar
              </button>
              <button type="button" onClick={() => setConfirmar(false)} className="min-h-9 px-2 text-xs text-suave">
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmar(true)} className="min-h-9 px-2 text-xs text-suave hover:text-vermelho">
              Apagar
            </button>
          )}
        </div>
      </div>
      <SeletorCor rotulo={`Cor da coluna ${col.nome}`} valor={col.cor} onChange={(cor) => salvar({ cor })} />
      {col.evento && <span className="text-[11px] text-suave">{EVENTOS.find((e) => e.valor === col.evento)?.descricao}, o contato vem para esta coluna.</span>}
    </li>
  );
}

export function ConfigCrmView({ crm }: { crm: DadosConfig }) {
  const [novaColuna, setNovaColuna] = useState("");
  const [novaEtiqueta, setNovaEtiqueta] = useState("");
  const [corEtiqueta, setCorEtiqueta] = useState(CORES[0]);
  const [editEtiqueta, setEditEtiqueta] = useState<string | null>(null);
  const [nomeEdit, setNomeEdit] = useState("");
  const [novoCampo, setNovoCampo] = useState("");
  const [tipoCampo, setTipoCampo] = useState<TipoCampo>("texto");

  const mover = (i: number, d: number) => {
    const ids = crm.colunas.map((c) => c.id);
    const j = i + d;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void crm.reordenarColunas(ids);
  };

  return (
    <>
      <header className="flex flex-col gap-1.5">
        <h1 className="font-titulo text-3xl font-bold tracking-tight">CRM</h1>
        <p className="text-sm text-suave">Organize as colunas do Kanban, as etiquetas e as informações que o robô guarda de cada cliente.</p>
      </header>

      <AbasCrm atual="configurar" aoVivo={crm.aoVivo} />
      {crm.erro && <p className="text-sm text-vermelho">{crm.erro}</p>}

      <Card title="Colunas do Kanban">
        <p className="text-sm text-suave">
          Escolha o <strong className="text-texto">evento automático</strong> de cada coluna: quando ele acontece na conversa, o robô move o contato para lá. Colunas
          “só manual” recebem contatos quando você arrasta ou pelo bloco <strong className="text-texto">Ação → Mover no Kanban</strong> do funil.
        </p>
        {crm.carregando ? (
          <p className="text-sm text-suave">Carregando…</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {crm.colunas.map((c, i) => (
              <LinhaColuna key={`${c.id}-${c.ordem}`} col={c} indice={i} total={crm.colunas.length} crm={crm} onMover={(d) => mover(i, d)} />
            ))}
          </ol>
        )}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!novaColuna.trim()) return;
            void crm.salvarColuna({ nome: novaColuna.trim(), cor: CORES[crm.colunas.length % CORES.length], evento: null });
            setNovaColuna("");
          }}
        >
          <label htmlFor="nova-coluna" className="sr-only">
            Nova coluna
          </label>
          <input id="nova-coluna" className={`${inputCls} max-w-xs`} placeholder="Nome da nova coluna" value={novaColuna} onChange={(e) => setNovaColuna(e.target.value)} />
          <button type="submit" className="min-h-10 rounded-[10px] bg-limao px-4 text-sm font-bold text-fundo">
            + Coluna
          </button>
        </form>
      </Card>

      <Card title="Etiquetas">
        <p className="text-sm text-suave">Use no funil (bloco Ação e Condição) e para filtrar contatos. O robô aplica sozinho durante a conversa.</p>
        <ul className="flex flex-col gap-2">
          {crm.etiquetas.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-borda bg-elevado p-3">
              {editEtiqueta === e.id ? (
                <>
                  <label htmlFor={`et-${e.id}`} className="sr-only">
                    Nome da etiqueta
                  </label>
                  <input id={`et-${e.id}`} className={`${inputCls} max-w-[200px]`} value={nomeEdit} onChange={(x) => setNomeEdit(x.target.value)} />
                  <SeletorCor rotulo="Cor da etiqueta" valor={e.cor} onChange={(cor) => void crm.salvarEtiqueta({ nome: nomeEdit || e.nome, cor }, e.id)} />
                  <button
                    type="button"
                    className="min-h-9 rounded-lg px-3 text-xs font-semibold text-limao"
                    onClick={() => {
                      void crm.salvarEtiqueta({ nome: nomeEdit, cor: e.cor }, e.id);
                      setEditEtiqueta(null);
                    }}
                  >
                    Pronto
                  </button>
                </>
              ) : (
                <>
                  <EtiquetaChip nome={e.nome} etiquetas={crm.etiquetas} />
                  <span className="ml-auto flex">
                    <button
                      type="button"
                      className="min-h-9 px-2 text-xs text-texto hover:text-limao"
                      onClick={() => {
                        setEditEtiqueta(e.id);
                        setNomeEdit(e.nome);
                      }}
                    >
                      Editar
                    </button>
                    <button type="button" className="min-h-9 px-2 text-xs text-suave hover:text-vermelho" onClick={() => void crm.apagarEtiqueta(e.id)}>
                      Apagar
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!novaEtiqueta.trim()) return;
            void crm.salvarEtiqueta({ nome: novaEtiqueta, cor: corEtiqueta });
            setNovaEtiqueta("");
          }}
        >
          <div className="flex flex-wrap gap-2">
            <label htmlFor="nova-etiqueta" className="sr-only">
              Nova etiqueta
            </label>
            <input id="nova-etiqueta" className={`${inputCls} max-w-xs`} placeholder="Ex.: Comprador, Quente, VIP" value={novaEtiqueta} onChange={(e) => setNovaEtiqueta(e.target.value)} />
            <button type="submit" className="min-h-10 rounded-[10px] bg-limao px-4 text-sm font-bold text-fundo">
              + Etiqueta
            </button>
          </div>
          <SeletorCor rotulo="Cor da nova etiqueta" valor={corEtiqueta} onChange={setCorEtiqueta} />
        </form>
      </Card>

      <Card title="Campos de informação">
        <p className="text-sm text-suave">
          O que o robô guarda de cada cliente (nome, e-mail, cidade, interesse…). Na <strong className="text-texto">Pergunta</strong> do funil, escolha o campo em “Salvar resposta no
          campo” e use <code className="rounded bg-elevado px-1">{"{chave}"}</code> nas mensagens.
        </p>
        <ul className="flex flex-col gap-2">
          {crm.campos.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-borda bg-elevado p-3 text-sm">
              <span className="font-semibold">{c.rotulo}</span>
              <code className="rounded bg-cartao px-1.5 text-xs text-suave">{`{${c.chave}}`}</code>
              <span className="text-xs text-suave">{c.tipo}</span>
              <button type="button" className="ml-auto min-h-9 px-2 text-xs text-suave hover:text-vermelho" onClick={() => void crm.apagarCampo(c.id)}>
                Apagar
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const chave = slugCampo(novoCampo);
            if (!chave) return;
            void crm.salvarCampo({ chave, rotulo: novoCampo.trim(), tipo: tipoCampo });
            setNovoCampo("");
          }}
        >
          <label htmlFor="novo-campo" className="sr-only">
            Novo campo
          </label>
          <input id="novo-campo" className={`${inputCls} max-w-xs`} placeholder="Ex.: Cidade" value={novoCampo} onChange={(e) => setNovoCampo(e.target.value)} />
          <label htmlFor="tipo-campo" className="sr-only">
            Tipo do campo
          </label>
          <select id="tipo-campo" className={`${inputCls} max-w-[140px]`} value={tipoCampo} onChange={(e) => setTipoCampo(e.target.value as TipoCampo)}>
            <option value="texto">Texto</option>
            <option value="numero">Número</option>
            <option value="email">E-mail</option>
            <option value="data">Data</option>
          </select>
          {novoCampo && <code className="text-xs text-suave">{`{${slugCampo(novoCampo)}}`}</code>}
          <button type="submit" className="min-h-10 rounded-[10px] bg-limao px-4 text-sm font-bold text-fundo">
            + Campo
          </button>
        </form>
      </Card>
    </>
  );
}
