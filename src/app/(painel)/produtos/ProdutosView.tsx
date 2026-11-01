"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import { brl, paraCentavos, paraInput } from "@/lib/dinheiro";

export type EntregaTipo = "link" | "arquivo" | "codigo";

export type Produto = {
  id: string;
  nome: string;
  descricao: string | null;
  preco_centavos: number;
  preco_minimo_centavos: number | null;
  custo_centavos: number;
  entrega_tipo: EntregaTipo;
  entrega_conteudo: string | null;
  mensagem_entrega: string | null;
  ativo: boolean;
};

export type NovoProduto = Omit<Produto, "id">;

export type Gateway = "mercadopago" | "asaas" | "efi" | "pagbank" | "outro";

export type ConfigPagamento = {
  gateway: Gateway | null;
  taxa_percentual: number;
  taxa_fixa_centavos: number;
};

export const GATEWAYS: { valor: Gateway; nome: string }[] = [
  { valor: "mercadopago", nome: "Mercado Pago" },
  { valor: "asaas", nome: "Asaas" },
  { valor: "efi", nome: "Efí (Gerencianet)" },
  { valor: "pagbank", nome: "PagBank" },
  { valor: "outro", nome: "Outro" },
];

const ENTREGAS: { valor: EntregaTipo; nome: string; rotulo: string; placeholder: string }[] = [
  { valor: "link", nome: "Link de acesso", rotulo: "Link enviado ao cliente", placeholder: "https://…" },
  { valor: "arquivo", nome: "Arquivo", rotulo: "Link do arquivo (PDF, etc.)", placeholder: "https://…/arquivo.pdf" },
  { valor: "codigo", nome: "Código / login", rotulo: "Código ou dados de acesso", placeholder: "Ex.: usuário e senha, cupom, chave…" },
];

const inputCls =
  "w-full min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";
const areaCls =
  "w-full rounded-[10px] border border-borda bg-fundo p-3 text-sm leading-relaxed text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";

/* ------------------------------------------------------------------ */
/* Gateway e taxas                                                     */
/* ------------------------------------------------------------------ */

export function liquidoPorVenda(precoCentavos: number, c: ConfigPagamento) {
  const taxa = Math.round((precoCentavos * (c.taxa_percentual || 0)) / 100) + (c.taxa_fixa_centavos || 0);
  return { taxa, liquido: precoCentavos - taxa };
}

function CartaoGateway({
  config,
  precoExemplo,
  onSalvar,
}: {
  config: ConfigPagamento;
  precoExemplo: number;
  onSalvar: (c: ConfigPagamento) => Promise<void>;
}) {
  const [gateway, setGateway] = useState<Gateway | "">(config.gateway ?? "");
  const [percentual, setPercentual] = useState(String(config.taxa_percentual ?? 0).replace(".", ","));
  const [fixa, setFixa] = useState(paraInput(config.taxa_fixa_centavos));
  const [estado, setEstado] = useState<"" | "salvando" | "salvo" | "erro">("");

  const atual: ConfigPagamento = {
    gateway: gateway || null,
    taxa_percentual: Number(percentual.replace(",", ".")) || 0,
    taxa_fixa_centavos: paraCentavos(fixa) ?? 0,
  };
  const { taxa, liquido } = liquidoPorVenda(precoExemplo, atual);

  async function salvar() {
    setEstado("salvando");
    try {
      await onSalvar(atual);
      setEstado("salvo");
    } catch {
      setEstado("erro");
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Gateway de Pix</h2>
          <p className="text-sm text-suave">Gera o Pix na conversa e avisa o robô quando o pagamento cai.</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            config.gateway ? "bg-elevado text-azul" : "border border-[#5a4220] bg-[#241b0e] text-laranja"
          }`}
        >
          {config.gateway ? `● ${GATEWAYS.find((g) => g.valor === config.gateway)?.nome} escolhido` : "● Nenhum gateway escolhido"}
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="gw" className="text-[13px] text-suave">
            Gateway
          </label>
          <select id="gw" className={inputCls} value={gateway} onChange={(e) => setGateway(e.target.value as Gateway | "")}>
            <option value="">Selecione…</option>
            {GATEWAYS.map((g) => (
              <option key={g.valor} value={g.valor}>
                {g.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="taxa-pct" className="text-[13px] text-suave">
            Taxa por Pix (%)
          </label>
          <input id="taxa-pct" inputMode="decimal" className={inputCls} value={percentual} onChange={(e) => setPercentual(e.target.value)} placeholder="0,99" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="taxa-fixa" className="text-[13px] text-suave">
            Taxa fixa por Pix (R$)
          </label>
          <input id="taxa-fixa" inputMode="decimal" className={inputCls} value={fixa} onChange={(e) => setFixa(e.target.value)} placeholder="0,00" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-elevado px-4 py-3 text-sm">
        <span className="text-suave">
          Numa venda de <strong className="text-texto">{brl(precoExemplo)}</strong>: taxa de{" "}
          <strong className="text-texto">{brl(taxa)}</strong> → você recebe <strong className="text-limao">{brl(liquido)}</strong>
          {precoExemplo > 0 && <span> ({((taxa / precoExemplo) * 100).toFixed(1).replace(".", ",")}% do valor)</span>}
        </span>
        <div className="flex items-center gap-3">
          {estado === "salvo" && <span className="text-xs text-suave">Salvo</span>}
          {estado === "erro" && <span className="text-xs text-vermelho">Erro ao salvar</span>}
          <button
            type="button"
            onClick={salvar}
            disabled={estado === "salvando"}
            className="min-h-10 rounded-[10px] bg-limao px-4 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60"
          >
            {estado === "salvando" ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>

      <p className="text-xs text-suave">
        Confira as taxas atuais no site do gateway. A conexão com a conta (token) é feita no servidor do robô, junto com a
        VPS, para a chave nunca ficar exposta no navegador.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Formulário de produto                                               */
/* ------------------------------------------------------------------ */

const VAZIO: NovoProduto = {
  nome: "",
  descricao: "",
  preco_centavos: 0,
  preco_minimo_centavos: null,
  custo_centavos: 0,
  entrega_tipo: "link",
  entrega_conteudo: "",
  mensagem_entrega: "Pagamento confirmado! ✅ Aqui está seu acesso:",
  ativo: true,
};

function FormProduto({
  inicial,
  onSalvar,
  onCancelar,
}: {
  inicial: NovoProduto;
  onSalvar: (p: NovoProduto) => Promise<void>;
  onCancelar: () => void;
}) {
  const [p, setP] = useState(inicial);
  const [preco, setPreco] = useState(inicial.preco_centavos ? paraInput(inicial.preco_centavos) : "");
  const [minimo, setMinimo] = useState(paraInput(inicial.preco_minimo_centavos));
  const [custo, setCusto] = useState(inicial.custo_centavos ? paraInput(inicial.custo_centavos) : "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const entrega = ENTREGAS.find((e) => e.valor === p.entrega_tipo) ?? ENTREGAS[0];

  async function salvar() {
    const precoC = paraCentavos(preco);
    const minimoC = minimo.trim() ? paraCentavos(minimo) : null;
    if (!p.nome.trim()) return setErro("Dê um nome ao produto.");
    if (!precoC) return setErro("Informe um preço válido.");
    if (minimo.trim() && minimoC === null) return setErro("Desconto máximo inválido.");
    if (minimoC !== null && minimoC > precoC) return setErro("O preço mínimo não pode ser maior que o preço.");
    setErro(null);
    setSalvando(true);
    try {
      await onSalvar({ ...p, nome: p.nome.trim(), preco_centavos: precoC, preco_minimo_centavos: minimoC, custo_centavos: paraCentavos(custo) ?? 0 });
    } catch {
      setErro("Não consegui salvar. Tente de novo.");
      setSalvando(false);
    }
  }

  return (
    <Card title={inicial.nome ? `Editar: ${inicial.nome}` : "Novo produto"}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="p-nome" className="text-[13px] text-suave">
            Nome do produto
          </label>
          <input id="p-nome" className={inputCls} value={p.nome} onChange={(e) => setP({ ...p, nome: e.target.value })} placeholder="Ex.: Guia completo de …" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="p-preco" className="text-[13px] text-suave">
            Preço (R$)
          </label>
          <input id="p-preco" inputMode="decimal" className={inputCls} value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="19,90" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="p-min" className="text-[13px] text-suave">
            Menor preço que o robô pode aceitar (opcional)
          </label>
          <input id="p-min" inputMode="decimal" className={inputCls} value={minimo} onChange={(e) => setMinimo(e.target.value)} placeholder="Ex.: 17,90" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="p-custo" className="text-[13px] text-suave">
            Custo por venda (R$, opcional)
          </label>
          <input id="p-custo" inputMode="decimal" className={inputCls} value={custo} onChange={(e) => setCusto(e.target.value)} placeholder="0,00 (produto digital)" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="p-desc" className="text-[13px] text-suave">
          Descrição curta (usada nas mensagens e pela IA)
        </label>
        <textarea id="p-desc" rows={2} className={areaCls} value={p.descricao ?? ""} onChange={(e) => setP({ ...p, descricao: e.target.value })} placeholder="O que é, o que a pessoa recebe, garantia…" />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] text-suave">Como entregar quando o Pix cair</legend>
        <div className="flex flex-wrap gap-2">
          {ENTREGAS.map((e) => (
            <button
              key={e.valor}
              type="button"
              aria-pressed={p.entrega_tipo === e.valor}
              onClick={() => setP({ ...p, entrega_tipo: e.valor })}
              className={`min-h-11 rounded-[10px] border px-4 text-sm ${
                p.entrega_tipo === e.valor ? "border-limao bg-limao-escuro font-semibold text-limao" : "border-borda bg-elevado text-texto"
              }`}
            >
              {e.nome}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="p-entrega" className="text-[13px] text-suave">
            {entrega.rotulo}
          </label>
          {p.entrega_tipo === "codigo" ? (
            <textarea id="p-entrega" rows={3} className={areaCls} value={p.entrega_conteudo ?? ""} onChange={(e) => setP({ ...p, entrega_conteudo: e.target.value })} placeholder={entrega.placeholder} />
          ) : (
            <input id="p-entrega" className={inputCls} value={p.entrega_conteudo ?? ""} onChange={(e) => setP({ ...p, entrega_conteudo: e.target.value })} placeholder={entrega.placeholder} />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="p-msg" className="text-[13px] text-suave">
            Mensagem enviada junto da entrega
          </label>
          <textarea id="p-msg" rows={3} className={areaCls} value={p.mensagem_entrega ?? ""} onChange={(e) => setP({ ...p, mensagem_entrega: e.target.value })} />
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-limao" checked={p.ativo} onChange={(e) => setP({ ...p, ativo: e.target.checked })} />
        Produto ativo (aparece nos blocos do funil)
      </label>

      {erro && (
        <p role="alert" className="text-sm text-vermelho">
          {erro}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={salvar} disabled={salvando} className="min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60">
          {salvando ? "Salvando…" : "Salvar produto"}
        </button>
        <button type="button" onClick={onCancelar} className="min-h-11 rounded-[10px] border border-borda bg-cartao px-5 text-sm font-medium hover:bg-elevado">
          Cancelar
        </button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Tela                                                                */
/* ------------------------------------------------------------------ */

export function ProdutosView({
  produtos,
  config,
  carregando,
  erro,
  onSalvarProduto,
  onApagarProduto,
  onAlternarAtivo,
  onSalvarConfig,
}: {
  produtos: Produto[];
  config: ConfigPagamento;
  carregando: boolean;
  erro: string | null;
  onSalvarProduto: (p: NovoProduto, id?: string) => Promise<void>;
  onApagarProduto: (id: string) => Promise<void>;
  onAlternarAtivo: (p: Produto) => Promise<void>;
  onSalvarConfig: (c: ConfigPagamento) => Promise<void>;
}) {
  const [editando, setEditando] = useState<Produto | "novo" | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const precoExemplo = produtos.find((p) => p.ativo)?.preco_centavos ?? 1990;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-titulo text-3xl font-bold tracking-tight">Produtos e pagamento</h1>
          <p className="text-sm text-suave">O que você vende, como recebe e como entrega</p>
        </div>
        {editando === null && (
          <button type="button" onClick={() => setEditando("novo")} className="min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110">
            + Novo produto
          </button>
        )}
      </header>

      {erro && <p className="text-sm text-vermelho">{erro}</p>}

      {editando !== null && (
        <FormProduto
          key={editando === "novo" ? "novo" : editando.id}
          inicial={editando === "novo" ? VAZIO : editando}
          onCancelar={() => setEditando(null)}
          onSalvar={async (p) => {
            await onSalvarProduto(p, editando === "novo" ? undefined : editando.id);
            setEditando(null);
          }}
        />
      )}

      <Card title="Produtos">
        {carregando && <p className="text-sm text-suave">Carregando…</p>}
        {!carregando && produtos.length === 0 && (
          <EmptyState
            title="Nenhum produto cadastrado"
            text="Cadastre o que você vende com preço e forma de entrega. Depois use o produto nos blocos Gerar Pix, Entregar e Upsell do funil."
          />
        )}
        {produtos.length > 0 && (
          <ul className="flex flex-col divide-y divide-borda">
            {produtos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-4 py-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-semibold">{p.nome}</span>
                  <span className="text-xs text-suave">
                    Entrega: {ENTREGAS.find((e) => e.valor === p.entrega_tipo)?.nome}
                    {!p.entrega_conteudo && <span className="text-laranja"> · falta o conteúdo da entrega</span>}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="font-titulo text-lg font-bold">{brl(p.preco_centavos)}</span>
                  {p.preco_minimo_centavos !== null && p.preco_minimo_centavos < p.preco_centavos && (
                    <span className="text-[11px] text-suave">mínimo {brl(p.preco_minimo_centavos)}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onAlternarAtivo(p)}
                  aria-pressed={p.ativo}
                  className={`min-h-9 rounded-full px-3 text-[11px] font-semibold ${p.ativo ? "bg-limao-escuro text-limao" : "bg-elevado text-suave"}`}
                >
                  {p.ativo ? "Ativo" : "Pausado"}
                </button>
                <button type="button" onClick={() => setEditando(p)} className="min-h-9 rounded-lg px-2 text-xs font-medium text-texto hover:text-limao">
                  Editar
                </button>
                {confirmar === p.id ? (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={async () => {
                        await onApagarProduto(p.id);
                        setConfirmar(null);
                      }}
                      className="min-h-9 rounded-lg px-2 text-xs font-semibold text-vermelho"
                    >
                      Confirmar
                    </button>
                    <button type="button" onClick={() => setConfirmar(null)} className="min-h-9 rounded-lg px-2 text-xs text-suave">
                      Cancelar
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmar(p.id)} className="min-h-9 rounded-lg px-2 text-xs text-suave hover:text-vermelho">
                    Apagar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!carregando && <CartaoGateway config={config} precoExemplo={precoExemplo} onSalvar={onSalvarConfig} />}

      <Card title="Upsell e recuperação de Pix">
        <p className="text-sm leading-relaxed text-suave">
          O upsell e os lembretes de Pix não pago são montados no <Link href="/funil">funil</Link>: use o bloco{" "}
          <strong className="text-texto">Upsell</strong> depois da entrega, e ligue a saída <strong className="text-texto">“Não pagou ainda”</strong> do bloco
          Gerar Pix a uma Mensagem de lembrete (com um Esperar entre um lembrete e outro).
        </p>
      </Card>
    </>
  );
}
