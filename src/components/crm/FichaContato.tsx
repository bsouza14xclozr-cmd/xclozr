"use client";

import { useEffect, useRef, useState } from "react";
import { brl } from "@/lib/dinheiro";
import { formatarTelefone, nomeContato, tempoRelativo, type CampoPersonalizado, type Coluna, type Contato, type Etiqueta, type PatchContato } from "@/lib/crm/tipos";
import { EtiquetaChip, areaCls, inputCls } from "./comum";

/** Ficha lateral do contato: informações, etiquetas, campos, coluna e notas. Salva sozinha. */
export function FichaContato({
  contato,
  colunas,
  etiquetas,
  campos,
  onAtualizar,
  onFechar,
}: {
  contato: Contato;
  colunas: Coluna[];
  etiquetas: Etiqueta[];
  campos: CampoPersonalizado[];
  onAtualizar: (patch: PatchContato) => void;
  onFechar: () => void;
}) {
  const [nome, setNome] = useState(contato.nome ?? "");
  const [notas, setNotas] = useState(contato.notas ?? "");
  const [valores, setValores] = useState<Record<string, string>>(contato.campos ?? {});
  const [novaEtiqueta, setNovaEtiqueta] = useState("");
  const primeiro = useRef(true);

  // salva textos com um pequeno atraso
  useEffect(() => {
    if (primeiro.current) {
      primeiro.current = false;
      return;
    }
    const t = setTimeout(() => onAtualizar({ nome: nome.trim() || null, notas: notas || null, campos: valores }), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só os textos disparam o salvamento
  }, [nome, notas, valores]);

  const alternarEtiqueta = (n: string) =>
    onAtualizar({ etiquetas: contato.etiquetas.includes(n) ? contato.etiquetas.filter((x) => x !== n) : [...contato.etiquetas, n] });

  const extras = Object.keys(valores).filter((k) => !campos.some((c) => c.chave === k));

  return (
    <aside
      aria-label={`Ficha de ${nomeContato(contato)}`}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-borda bg-lateral shadow-2xl"
    >
      <div className="flex items-start gap-3 border-b border-borda p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="ficha-nome" className="sr-only">
            Nome
          </label>
          <input
            id="ficha-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={formatarTelefone(contato.telefone)}
            className="min-h-10 rounded-lg border border-transparent bg-transparent px-1 text-lg font-semibold text-texto hover:border-borda focus:border-limao focus:outline-none"
          />
          <span className="px-1 text-xs text-suave">
            {formatarTelefone(contato.telefone)} · chegou {new Date(contato.criado_em).toLocaleDateString("pt-BR")}
          </span>
        </div>
        <button type="button" aria-label="Fechar ficha" onClick={onFechar} className="flex h-9 w-9 items-center justify-center rounded-lg text-suave hover:bg-elevado hover:text-texto">
          ✕
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 rounded-xl bg-elevado p-3">
            <span className="text-[11px] text-suave">Total comprado</span>
            <span className="font-titulo text-lg font-bold text-limao">{brl(contato.total_pago_centavos)}</span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl bg-elevado p-3">
            <span className="text-[11px] text-suave">Última mensagem</span>
            <span className="text-sm font-semibold">{tempoRelativo(contato.ultima_msg_em)}</span>
          </div>
          <div className="col-span-2 flex flex-col gap-1 rounded-xl bg-elevado p-3">
            <span className="text-[11px] text-suave">Origem</span>
            <span className="text-sm">{contato.anuncio_nome ?? "Sem anúncio (orgânico)"}</span>
            {contato.pix_pendente && <span className="text-xs font-semibold text-laranja">● Tem Pix pendente</span>}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ficha-coluna" className="text-[13px] font-medium">
            Coluna do Kanban
          </label>
          <select id="ficha-coluna" className={inputCls} value={contato.kanban_coluna_id ?? ""} onChange={(e) => onAtualizar({ kanban_coluna_id: e.target.value || null })}>
            <option value="">Sem coluna</option>
            {colunas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-xl border border-borda p-3 text-sm">
          <span className="flex flex-col">
            <span className="font-medium">Robô ativo nesta conversa</span>
            <span className="text-xs text-suave">Desligue para atender você mesmo</span>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-limao" checked={contato.robo_ativo} onChange={(e) => onAtualizar({ robo_ativo: e.target.checked })} />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">Etiquetas</span>
          <div className="flex flex-wrap gap-1.5">
            {etiquetas.map((e) => (
              <EtiquetaChip key={e.id} nome={e.nome} etiquetas={etiquetas} ativa={contato.etiquetas.includes(e.nome)} onClick={() => alternarEtiqueta(e.nome)} />
            ))}
            {contato.etiquetas
              .filter((n) => !etiquetas.some((e) => e.nome === n))
              .map((n) => (
                <EtiquetaChip key={n} nome={n} etiquetas={etiquetas} onClick={() => alternarEtiqueta(n)} />
              ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = novaEtiqueta.trim();
              if (n && !contato.etiquetas.includes(n)) onAtualizar({ etiquetas: [...contato.etiquetas, n] });
              setNovaEtiqueta("");
            }}
          >
            <label htmlFor="ficha-nova-etiqueta" className="sr-only">
              Nova etiqueta
            </label>
            <input id="ficha-nova-etiqueta" className={inputCls} placeholder="Adicionar etiqueta…" value={novaEtiqueta} onChange={(e) => setNovaEtiqueta(e.target.value)} />
            <button type="submit" className="min-h-10 rounded-[10px] border border-borda px-3 text-sm hover:bg-elevado">
              +
            </button>
          </form>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-medium">Informações</span>
          {campos.length === 0 && extras.length === 0 && (
            <p className="text-xs text-suave">Crie campos em “Colunas, etiquetas e campos”. O robô preenche sozinho com as respostas das perguntas do funil.</p>
          )}
          {campos.map((c) => (
            <div key={c.id} className="flex flex-col gap-1">
              <label htmlFor={`campo-${c.chave}`} className="text-xs text-suave">
                {c.rotulo}
              </label>
              <input
                id={`campo-${c.chave}`}
                type={c.tipo === "numero" ? "number" : c.tipo === "email" ? "email" : c.tipo === "data" ? "date" : "text"}
                className={inputCls}
                value={valores[c.chave] ?? ""}
                onChange={(e) => setValores((v) => ({ ...v, [c.chave]: e.target.value }))}
              />
            </div>
          ))}
          {extras.map((k) => (
            <div key={k} className="flex flex-col gap-1">
              <label htmlFor={`campo-${k}`} className="text-xs text-suave">
                {k}
              </label>
              <input id={`campo-${k}`} className={inputCls} value={valores[k] ?? ""} onChange={(e) => setValores((v) => ({ ...v, [k]: e.target.value }))} />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ficha-notas" className="text-[13px] font-medium">
            Notas
          </label>
          <textarea id="ficha-notas" rows={4} className={areaCls} placeholder="Anotações sobre este cliente…" value={notas} onChange={(e) => setNotas(e.target.value)} />
        </div>
      </div>
    </aside>
  );
}
