"use client";

import {
  OPCOES_ACAO,
  OPCOES_REGRA,
  VARIAVEIS,
  blocoDe,
  type Acao,
  type Campo,
  type Config,
  type ItemMensagem,
  type Objecao,
  type Regra,
} from "@/lib/funil/blocos";
import type { NoBloco } from "@/lib/funil/grafo";
import { IconeBloco } from "./BlocoNode";

export type Opcao = { id: string; nome: string };

const inputCls =
  "w-full min-h-10 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";
const areaCls =
  "w-full rounded-[10px] border border-borda bg-fundo p-3 text-sm leading-relaxed text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";
const btnSec =
  "min-h-9 rounded-lg border border-dashed border-borda px-3 text-xs font-medium text-texto hover:border-limao hover:text-limao";
const btnApagar = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-suave hover:bg-elevado hover:text-vermelho";

function Lixeira() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  );
}

function Rotulo({ id, texto, dica }: { id: string; texto: string; dica?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="text-[13px] font-medium text-texto">
        {texto}
      </label>
      {dica && <span className="text-[11px] text-suave">{dica}</span>}
    </div>
  );
}

/* ---------- campos compostos ---------- */

const ROTULO_ITEM: Record<ItemMensagem["tipo"], string> = {
  texto: "Texto",
  imagem: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  arquivo: "Arquivo",
  espera: "Espera",
};

function novoItem(tipo: ItemMensagem["tipo"]): ItemMensagem {
  switch (tipo) {
    case "texto":
      return { tipo, texto: "" };
    case "imagem":
    case "video":
      return { tipo, url: "", legenda: "" };
    case "audio":
      return { tipo, url: "" };
    case "arquivo":
      return { tipo, url: "", nome: "" };
    case "espera":
      return { tipo, segundos: 3, digitando: true };
  }
}

function ItensMensagem({ id, valor, onChange }: { id: string; valor: ItemMensagem[]; onChange: (v: ItemMensagem[]) => void }) {
  const set = (i: number, item: ItemMensagem) => onChange(valor.map((x, j) => (j === i ? item : x)));
  const mover = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= valor.length) return;
    const c = [...valor];
    [c[i], c[j]] = [c[j], c[i]];
    onChange(c);
  };

  return (
    <div className="flex flex-col gap-3">
      {valor.map((item, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-borda bg-elevado p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-suave">
              {i + 1}. {ROTULO_ITEM[item.tipo]}
            </span>
            <div className="flex items-center">
              <button type="button" aria-label="Mover para cima" className={btnApagar} onClick={() => mover(i, -1)}>
                ↑
              </button>
              <button type="button" aria-label="Mover para baixo" className={btnApagar} onClick={() => mover(i, 1)}>
                ↓
              </button>
              <button type="button" aria-label="Remover item" className={btnApagar} onClick={() => onChange(valor.filter((_, j) => j !== i))}>
                <Lixeira />
              </button>
            </div>
          </div>

          {item.tipo === "texto" && (
            <textarea
              id={i === 0 ? id : undefined}
              aria-label="Texto da mensagem"
              rows={3}
              className={areaCls}
              placeholder="Escreva a mensagem… use {nome} para personalizar"
              value={item.texto}
              onChange={(e) => set(i, { ...item, texto: e.target.value })}
            />
          )}
          {(item.tipo === "imagem" || item.tipo === "video") && (
            <>
              <input aria-label="Link do arquivo" className={inputCls} placeholder="Link do arquivo (https://…)" value={item.url} onChange={(e) => set(i, { ...item, url: e.target.value })} />
              <input aria-label="Legenda" className={inputCls} placeholder="Legenda (opcional)" value={item.legenda} onChange={(e) => set(i, { ...item, legenda: e.target.value })} />
            </>
          )}
          {item.tipo === "audio" && (
            <>
              <input aria-label="Link do áudio" className={inputCls} placeholder="Link do áudio (https://…)" value={item.url} onChange={(e) => set(i, { ...item, url: e.target.value })} />
              <span className="text-[11px] text-suave">Enviado como áudio gravado na hora, com “gravando áudio…” antes.</span>
            </>
          )}
          {item.tipo === "arquivo" && (
            <>
              <input aria-label="Link do arquivo" className={inputCls} placeholder="Link do arquivo (https://…)" value={item.url} onChange={(e) => set(i, { ...item, url: e.target.value })} />
              <input aria-label="Nome do arquivo" className={inputCls} placeholder="Nome do arquivo (ex.: guia.pdf)" value={item.nome} onChange={(e) => set(i, { ...item, nome: e.target.value })} />
            </>
          )}
          {item.tipo === "espera" && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <input
                aria-label="Segundos de espera"
                type="number"
                min={1}
                className={`${inputCls} !w-24`}
                value={item.segundos}
                onChange={(e) => set(i, { ...item, segundos: Number(e.target.value) || 1 })}
              />
              <span className="text-suave">segundos</span>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={item.digitando} onChange={(e) => set(i, { ...item, digitando: e.target.checked })} className="accent-limao" />
                mostrar “digitando…”
              </label>
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        {(Object.keys(ROTULO_ITEM) as ItemMensagem["tipo"][]).map((t) => (
          <button key={t} type="button" className={btnSec} onClick={() => onChange([...valor, novoItem(t)])}>
            + {ROTULO_ITEM[t]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ListaSimples({
  valor,
  onChange,
  placeholder,
  pesos,
  onPesos,
}: {
  valor: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  pesos?: number[];
  onPesos?: (p: number[]) => void;
}) {
  const total = pesos?.reduce((a, b) => a + (Number(b) || 0), 0) ?? 0;
  return (
    <div className="flex flex-col gap-2">
      {valor.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-5 text-right text-xs text-suave">{i + 1}.</span>
          <input aria-label={`Item ${i + 1}`} className={inputCls} value={v} placeholder={placeholder} onChange={(e) => onChange(valor.map((x, j) => (j === i ? e.target.value : x)))} />
          {pesos && onPesos && (
            <input
              aria-label={`Porcentagem do item ${i + 1}`}
              type="number"
              min={0}
              max={100}
              className={`${inputCls} !w-20`}
              value={pesos[i] ?? 0}
              onChange={(e) => onPesos(valor.map((_, j) => (j === i ? Number(e.target.value) || 0 : (pesos[j] ?? 0))))}
            />
          )}
          <button
            type="button"
            aria-label="Remover"
            className={btnApagar}
            onClick={() => {
              onChange(valor.filter((_, j) => j !== i));
              if (pesos && onPesos) onPesos(pesos.filter((_, j) => j !== i));
            }}
          >
            <Lixeira />
          </button>
        </div>
      ))}
      {pesos && (
        <span className={`text-[11px] ${total === 100 ? "text-suave" : "text-laranja"}`}>Total: {total}% {total !== 100 && "(o ideal é 100%)"}</span>
      )}
      <button
        type="button"
        className={btnSec}
        onClick={() => {
          onChange([...valor, ""]);
          if (pesos && onPesos) onPesos([...pesos, 0]);
        }}
      >
        + Adicionar
      </button>
    </div>
  );
}

function ListaObjecoes({ valor, onChange }: { valor: Objecao[]; onChange: (v: Objecao[]) => void }) {
  const set = (i: number, o: Objecao) => onChange(valor.map((x, j) => (j === i ? o : x)));
  return (
    <div className="flex flex-col gap-3">
      {valor.map((o, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-borda bg-elevado p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-suave">Objeção {i + 1}</span>
            <button type="button" aria-label="Remover objeção" className={btnApagar} onClick={() => onChange(valor.filter((_, j) => j !== i))}>
              <Lixeira />
            </button>
          </div>
          <input aria-label="Palavras da objeção" className={inputCls} placeholder="Palavras (ex.: golpe, confiável)" value={o.palavras} onChange={(e) => set(i, { ...o, palavras: e.target.value })} />
          <textarea aria-label="Resposta da objeção" rows={3} className={areaCls} placeholder="Resposta do robô" value={o.resposta} onChange={(e) => set(i, { ...o, resposta: e.target.value })} />
        </div>
      ))}
      <button type="button" className={btnSec} onClick={() => onChange([...valor, { palavras: "", resposta: "" }])}>
        + Objeção
      </button>
    </div>
  );
}

function ListaAcoes({ valor, onChange }: { valor: Acao[]; onChange: (v: Acao[]) => void }) {
  const set = (i: number, a: Acao) => onChange(valor.map((x, j) => (j === i ? a : x)));
  return (
    <div className="flex flex-col gap-3">
      {valor.map((a, i) => {
        const def = OPCOES_ACAO.find((o) => o.valor === a.tipo);
        return (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-borda bg-elevado p-3">
            <div className="flex items-center gap-2">
              <select aria-label="Tipo de ação" className={inputCls} value={a.tipo} onChange={(e) => set(i, { tipo: e.target.value as Acao["tipo"], valor: "", valor2: "" })}>
                {OPCOES_ACAO.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
              <button type="button" aria-label="Remover ação" className={btnApagar} onClick={() => onChange(valor.filter((_, j) => j !== i))}>
                <Lixeira />
              </button>
            </div>
            {def?.pede && <input aria-label={def.pede} className={inputCls} placeholder={def.pede} value={a.valor} onChange={(e) => set(i, { ...a, valor: e.target.value })} />}
            {def?.pede2 && <input aria-label={def.pede2} className={inputCls} placeholder={def.pede2} value={a.valor2 ?? ""} onChange={(e) => set(i, { ...a, valor2: e.target.value })} />}
          </div>
        );
      })}
      <button type="button" className={btnSec} onClick={() => onChange([...valor, { tipo: "etiqueta_add", valor: "" }])}>
        + Ação
      </button>
    </div>
  );
}

function ListaRegras({ valor, onChange }: { valor: Regra[]; onChange: (v: Regra[]) => void }) {
  const set = (i: number, r: Regra) => onChange(valor.map((x, j) => (j === i ? r : x)));
  return (
    <div className="flex flex-col gap-3">
      {valor.map((r, i) => {
        const def = OPCOES_REGRA.find((o) => o.valor === r.tipo) ?? OPCOES_REGRA[0];
        const semValor = ["preenchido", "vazio"].includes(r.operador) || r.tipo === "ja_comprou" || r.tipo === "pix_pendente";
        return (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-borda bg-elevado p-3">
            <div className="flex items-center gap-2">
              <select
                aria-label="Tipo de regra"
                className={inputCls}
                value={r.tipo}
                onChange={(e) => {
                  const nd = OPCOES_REGRA.find((o) => o.valor === e.target.value)!;
                  set(i, { tipo: nd.valor, operador: nd.operadores[0].valor, valor: "", valor2: "" });
                }}
              >
                {OPCOES_REGRA.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
              <button type="button" aria-label="Remover regra" className={btnApagar} onClick={() => onChange(valor.filter((_, j) => j !== i))}>
                <Lixeira />
              </button>
            </div>
            <select aria-label="Operador" className={inputCls} value={r.operador} onChange={(e) => set(i, { ...r, operador: e.target.value })}>
              {def.operadores.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
            {!semValor && def.pede && (
              <input aria-label={def.pede} className={inputCls} placeholder={def.pede} value={r.valor} onChange={(e) => set(i, { ...r, valor: e.target.value })} />
            )}
            {def.pede2 && (r.tipo === "horario" || (r.tipo === "campo" && !semValor)) && (
              <input aria-label={def.pede2} className={inputCls} placeholder={def.pede2} value={r.valor2 ?? ""} onChange={(e) => set(i, { ...r, valor2: e.target.value })} />
            )}
            {r.tipo === "campo" && semValor && (
              <input aria-label="Campo" className={inputCls} placeholder="Campo" value={r.valor} onChange={(e) => set(i, { ...r, valor: e.target.value })} />
            )}
          </div>
        );
      })}
      <button type="button" className={btnSec} onClick={() => onChange([...valor, { tipo: "mensagem", operador: "contem", valor: "" }])}>
        + Regra
      </button>
    </div>
  );
}

/* ---------- painel ---------- */

function CampoForm({
  campo,
  config,
  set,
  produtos,
  funis,
  idNo,
}: {
  campo: Campo;
  config: Config;
  set: (chave: string, valor: unknown) => void;
  produtos: Opcao[];
  funis: Opcao[];
  idNo: string;
}) {
  const id = `${idNo}-${campo.chave}`;
  const v = config[campo.chave];
  const dica = "dica" in campo ? campo.dica : undefined;

  switch (campo.tipo) {
    case "texto":
      return (
        <div className="flex flex-col gap-1.5">
          <Rotulo id={id} texto={campo.rotulo} dica={dica} />
          <input id={id} className={inputCls} placeholder={campo.placeholder} value={(v as string) ?? ""} onChange={(e) => set(campo.chave, e.target.value)} />
        </div>
      );
    case "textarea":
      return (
        <div className="flex flex-col gap-1.5">
          <Rotulo id={id} texto={campo.rotulo} dica={dica} />
          <textarea id={id} rows={4} className={areaCls} placeholder={campo.placeholder} value={(v as string) ?? ""} onChange={(e) => set(campo.chave, e.target.value)} />
          {campo.variaveis && (
            <div className="flex flex-wrap gap-1.5">
              {VARIAVEIS.map((x) => (
                <button key={x} type="button" className="rounded-md bg-elevado px-2 py-1 text-[11px] text-suave hover:text-limao" onClick={() => set(campo.chave, `${(v as string) ?? ""}${x}`)}>
                  {x}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    case "numero":
      return (
        <div className="flex flex-col gap-1.5">
          <Rotulo id={id} texto={campo.rotulo} dica={dica} />
          <div className="flex items-center gap-2">
            <input id={id} type="number" min={campo.min} className={`${inputCls} !w-28`} value={(v as number) ?? ""} onChange={(e) => set(campo.chave, e.target.value === "" ? "" : Number(e.target.value))} />
            {campo.sufixo && <span className="text-sm text-suave">{campo.sufixo}</span>}
          </div>
        </div>
      );
    case "select":
      return (
        <div className="flex flex-col gap-1.5">
          <Rotulo id={id} texto={campo.rotulo} dica={dica} />
          <select id={id} className={inputCls} value={(v as string) ?? ""} onChange={(e) => set(campo.chave, e.target.value)}>
            {campo.opcoes.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </div>
      );
    case "booleano":
      return (
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-limao" checked={Boolean(v)} onChange={(e) => set(campo.chave, e.target.checked)} />
          {campo.rotulo}
        </label>
      );
    case "lista":
      return (
        <div className="flex flex-col gap-1.5">
          <Rotulo id={id} texto={campo.rotulo} dica={dica} />
          <ListaSimples
            valor={(v as string[]) ?? []}
            onChange={(x) => set(campo.chave, x)}
            placeholder={campo.placeholder}
            pesos={campo.comPeso ? ((config.pesos as number[]) ?? []) : undefined}
            onPesos={campo.comPeso ? (p) => set("pesos", p) : undefined}
          />
        </div>
      );
    case "itens_mensagem":
      return <ItensMensagem id={id} valor={(v as ItemMensagem[]) ?? []} onChange={(x) => set(campo.chave, x)} />;
    case "objecoes":
      return (
        <div className="flex flex-col gap-1.5">
          <Rotulo id={id} texto={campo.rotulo} />
          <ListaObjecoes valor={(v as Objecao[]) ?? []} onChange={(x) => set(campo.chave, x)} />
        </div>
      );
    case "acoes":
      return <ListaAcoes valor={(v as Acao[]) ?? []} onChange={(x) => set(campo.chave, x)} />;
    case "regras":
      return (
        <div className="flex flex-col gap-1.5">
          <Rotulo id={id} texto={campo.rotulo} />
          <ListaRegras valor={(v as Regra[]) ?? []} onChange={(x) => set(campo.chave, x)} />
        </div>
      );
    case "produto":
    case "funil": {
      const opcoes = campo.tipo === "produto" ? produtos : funis;
      return (
        <div className="flex flex-col gap-1.5">
          <Rotulo id={id} texto={campo.rotulo} dica={dica} />
          <select id={id} className={inputCls} value={(v as string) ?? ""} onChange={(e) => set(campo.chave, e.target.value)}>
            <option value="">Selecione…</option>
            {opcoes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
          {opcoes.length === 0 && (
            <span className="text-[11px] text-laranja">
              {campo.tipo === "produto" ? "Cadastre um produto em Produtos e Pix." : "Crie outro funil primeiro."}
            </span>
          )}
        </div>
      );
    }
  }
}

export function PainelConfig({
  no,
  onChange,
  onApagar,
  onDuplicar,
  onFechar,
  produtos,
  funis,
}: {
  no: NoBloco;
  onChange: (config: Config) => void;
  onApagar: () => void;
  onDuplicar: () => void;
  onFechar: () => void;
  produtos: Opcao[];
  funis: Opcao[];
}) {
  const def = blocoDe(no.data.tipo);
  const config = no.data.config;
  const set = (chave: string, valor: unknown) => onChange({ ...config, [chave]: valor });
  const inicio = no.data.tipo === "inicio";

  return (
    <aside aria-label={`Configurar ${def.nome}`} className="flex h-full w-full flex-col border-l border-borda bg-lateral md:w-[380px]">
      <div className="flex items-center gap-2.5 border-b border-borda px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${def.cor}24` }}>
          <IconeBloco path={def.icone} cor={def.cor} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">{def.nome}</span>
          <span className="truncate text-[11px] text-suave">{def.descricao}</span>
        </div>
        <button type="button" aria-label="Fechar painel" className={btnApagar} onClick={onFechar}>
          ✕
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        {inicio ? (
          <p className="text-sm text-suave">
            O funil começa aqui. Ligue a saída “Começar” ao primeiro bloco (normalmente uma Mensagem de boas-vindas).
          </p>
        ) : (
          def.campos.map((c) => <CampoForm key={c.chave} campo={c} config={config} set={set} produtos={produtos} funis={funis} idNo={no.id} />)
        )}
      </div>

      {!inicio && (
        <div className="flex gap-2 border-t border-borda p-3">
          <button type="button" onClick={onDuplicar} className="min-h-10 flex-1 rounded-[10px] border border-borda bg-cartao text-sm font-medium hover:bg-elevado">
            Duplicar
          </button>
          <button type="button" onClick={onApagar} className="min-h-10 flex-1 rounded-[10px] border border-borda bg-cartao text-sm font-medium text-vermelho hover:bg-elevado">
            Apagar bloco
          </button>
        </div>
      )}
    </aside>
  );
}
