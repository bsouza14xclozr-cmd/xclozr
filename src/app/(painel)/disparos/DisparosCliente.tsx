"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { CampoMidia } from "@/components/funil/PainelConfig";

type Filtro = {
  colunas?: string[];
  etiquetas?: string[];
  sem_etiquetas?: string[];
  comprou?: "" | "sim" | "nao";
  pix_pendente?: boolean;
  conversou_dias?: number;
  parado_horas?: number;
  incluir_pausados?: boolean;
};
type TipoMidia = "imagem" | "video" | "audio" | "arquivo";
type Campanha = {
  id: string;
  nome: string;
  mensagem: string;
  midia_tipo: TipoMidia | null;
  midia_url: string | null;
  incluir_sair: boolean;
  filtro: Filtro;
  funil_id: string | null;
  intervalo_min_seg: number;
  intervalo_max_seg: number;
  limite_diario_chip: number;
  janela_inicio: number;
  janela_fim: number;
  status: "rascunho" | "enviando" | "pausada" | "concluida" | "cancelada";
  total: number;
  enviados: number;
  falhas: number;
  proximo_envio_em: string | null;
  criado_em: string;
};
type Opcao = { id: string; nome: string };

const CAMPOS = "id, nome, mensagem, midia_tipo, midia_url, incluir_sair, filtro, funil_id, intervalo_min_seg, intervalo_max_seg, limite_diario_chip, janela_inicio, janela_fim, status, total, enviados, falhas, proximo_envio_em, criado_em";

const NOVA: Omit<Campanha, "id" | "status" | "total" | "enviados" | "falhas" | "proximo_envio_em" | "criado_em"> = {
  nome: "",
  mensagem: "{Oi|Olá|E aí} {nome}! ",
  midia_tipo: null,
  midia_url: null,
  incluir_sair: true,
  filtro: { conversou_dias: 30, parado_horas: 24, comprou: "" },
  funil_id: null,
  intervalo_min_seg: 45,
  intervalo_max_seg: 120,
  limite_diario_chip: 150,
  janela_inicio: 9,
  janela_fim: 20,
};

const inputCls =
  "w-full min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";
const STATUS: Record<Campanha["status"], { t: string; c: string }> = {
  rascunho: { t: "Rascunho", c: "bg-elevado text-suave" },
  enviando: { t: "Enviando", c: "bg-limao-escuro text-limao" },
  pausada: { t: "Pausado", c: "bg-[#241b0e] text-laranja" },
  concluida: { t: "Concluído", c: "bg-[#10283a] text-azul" },
  cancelada: { t: "Cancelado", c: "bg-[#2a1215] text-vermelho" },
};

function variar(t: string) {
  return t.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, g: string) => g.split("|")[0]).replace(/\{nome\}/g, "Ana");
}

function duracao(total: number, min: number, max: number) {
  const seg = (total * (min + max)) / 2;
  if (seg < 3600) return `${Math.max(1, Math.round(seg / 60))} min`;
  return `${(seg / 3600).toFixed(1).replace(".", ",")} h`;
}

function Chips({ opcoes, valor, onChange, cor = "limao" }: { opcoes: Opcao[]; valor: string[]; onChange: (v: string[]) => void; cor?: "limao" | "vermelho" }) {
  if (!opcoes.length) return <span className="text-xs text-suave">Nenhuma ainda.</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {opcoes.map((o) => {
        const on = valor.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? valor.filter((x) => x !== o.id) : [...valor, o.id])}
            className={`min-h-8 rounded-full border px-3 text-xs ${
              on ? (cor === "limao" ? "border-limao/60 bg-limao-escuro text-limao" : "border-vermelho/60 bg-[#2a1215] text-vermelho") : "border-borda bg-fundo text-suave hover:text-texto"
            }`}
          >
            {o.nome}
          </button>
        );
      })}
    </div>
  );
}

function Editor({
  inicial,
  colunas,
  etiquetas,
  funis,
  onFechar,
  onSalvo,
}: {
  inicial: typeof NOVA & { id?: string };
  colunas: Opcao[];
  etiquetas: Opcao[];
  funis: Opcao[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [c, setC] = useState(inicial);
  const [publico, setPublico] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const f = c.filtro;
  const setF = (p: Partial<Filtro>) => setC((x) => ({ ...x, filtro: { ...x.filtro, ...p } }));
  const filtroStr = JSON.stringify(f);

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(async () => {
      const { data, error } = await createClient().rpc("contar_publico", { f: JSON.parse(filtroStr) });
      if (vivo) setPublico(error ? null : (data as number));
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [filtroStr]);

  async function salvar(iniciar: boolean) {
    setErro(null);
    if (!c.nome.trim()) return setErro("Dê um nome ao disparo.");
    if (!c.mensagem.trim() && !c.midia_url) return setErro("Escreva a mensagem.");
    if (c.intervalo_max_seg < c.intervalo_min_seg) return setErro("O intervalo máximo precisa ser maior que o mínimo.");
    setSalvando(true);
    const supabase = createClient();
    const dados = {
      nome: c.nome.trim(),
      mensagem: c.mensagem,
      midia_tipo: c.midia_url ? c.midia_tipo : null,
      midia_url: c.midia_url || null,
      incluir_sair: c.incluir_sair,
      filtro: c.filtro,
      funil_id: c.funil_id || null,
      intervalo_min_seg: Math.max(10, c.intervalo_min_seg),
      intervalo_max_seg: Math.max(10, c.intervalo_max_seg),
      limite_diario_chip: Math.max(1, c.limite_diario_chip),
      janela_inicio: c.janela_inicio,
      janela_fim: c.janela_fim,
    };
    const r = c.id ? await supabase.from("campanhas").update(dados).eq("id", c.id).select("id").single() : await supabase.from("campanhas").insert(dados).select("id").single();
    if (r.error || !r.data) {
      setSalvando(false);
      return setErro("Não consegui salvar o disparo.");
    }
    if (iniciar) {
      const { error } = await supabase.rpc("iniciar_campanha", { p_id: r.data.id });
      if (error) {
        setSalvando(false);
        setC((x) => ({ ...x, id: r.data.id }));
        return setErro(error.message.includes("nenhum contato") ? "Nenhum contato nesse público." : `Não consegui iniciar: ${error.message}`);
      }
    }
    setSalvando(false);
    onSalvo();
  }

  return (
    <Card title={c.id ? "Editar disparo" : "Novo disparo"}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-[13px] text-suave">
            Nome (só para você)
            <input className={inputCls} value={c.nome} onChange={(e) => setC({ ...c, nome: e.target.value })} placeholder="Ex.: Recuperar Pix de outubro" maxLength={80} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-suave">
            Mensagem
            <textarea
              rows={5}
              className={`${inputCls} py-2.5 leading-relaxed`}
              value={c.mensagem}
              onChange={(e) => setC({ ...c, mensagem: e.target.value })}
              placeholder="{Oi|Olá} {nome}! Ainda dá tempo de garantir o seu…"
            />
            <span className="text-[11px]">
              Use <code>{"{nome}"}</code> para o primeiro nome e <code>{"{Oi|Olá|E aí}"}</code> para cada cliente receber uma variação (ajuda contra ban).
            </span>
          </label>
          {c.mensagem.trim() && (
            <div className="rounded-xl border border-borda bg-fundo p-3 text-sm">
              <span className="text-[11px] text-suave">Exemplo de como chega:</span>
              <p className="mt-1 whitespace-pre-wrap">{variar(c.mensagem)}</p>
              {c.incluir_sair && <p className="mt-2 text-xs italic text-suave">Se não quiser mais receber, responda SAIR.</p>}
            </div>
          )}
          <div className="flex flex-col gap-2 text-[13px] text-suave">
            Mídia (opcional)
            <div className="flex flex-wrap gap-1.5">
              {(["", "imagem", "video", "audio", "arquivo"] as const).map((t) => (
                <button
                  key={t || "nada"}
                  type="button"
                  aria-pressed={(c.midia_tipo ?? "") === t}
                  onClick={() => setC({ ...c, midia_tipo: t || null, midia_url: t === (c.midia_tipo ?? "") ? c.midia_url : null })}
                  className={`min-h-8 rounded-full border px-3 text-xs ${(c.midia_tipo ?? "") === t ? "border-limao/60 bg-limao-escuro text-limao" : "border-borda bg-fundo text-suave"}`}
                >
                  {t === "" ? "Sem mídia" : t === "video" ? "Vídeo" : t === "audio" ? "Áudio" : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {c.midia_tipo && <CampoMidia tipo={c.midia_tipo} url={c.midia_url ?? ""} onChange={(url) => setC({ ...c, midia_url: url || null })} />}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.incluir_sair} onChange={(e) => setC({ ...c, incluir_sair: e.target.checked })} className="accent-[#5ed98c]" />
            Incluir “responda SAIR para não receber mais” <span className="text-xs text-suave">(recomendado)</span>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-suave">
            Quando o cliente responder
            <select className={inputCls} value={c.funil_id ?? ""} onChange={(e) => setC({ ...c, funil_id: e.target.value || null })}>
              <option value="">Continuar onde ele estava (ou no funil padrão)</option>
              {funis.map((x) => (
                <option key={x.id} value={x.id}>
                  Começar o funil “{x.nome}”
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-xl border border-borda bg-fundo px-4 py-3">
            <span className="text-sm text-suave">Contatos neste público</span>
            <span className="font-titulo text-2xl font-bold text-limao">{publico ?? "…"}</span>
          </div>
          <div className="flex flex-col gap-2 text-[13px] text-suave">
            Colunas do CRM <span className="text-[11px]">(nenhuma marcada = todas)</span>
            <Chips opcoes={colunas} valor={f.colunas ?? []} onChange={(v) => setF({ colunas: v })} />
          </div>
          <div className="flex flex-col gap-2 text-[13px] text-suave">
            Com a etiqueta
            <Chips opcoes={etiquetas} valor={f.etiquetas ?? []} onChange={(v) => setF({ etiquetas: v })} />
          </div>
          <div className="flex flex-col gap-2 text-[13px] text-suave">
            Sem a etiqueta
            <Chips opcoes={etiquetas} valor={f.sem_etiquetas ?? []} onChange={(v) => setF({ sem_etiquetas: v })} cor="vermelho" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-[13px] text-suave">
              Já comprou?
              <select className={inputCls} value={f.comprou ?? ""} onChange={(e) => setF({ comprou: e.target.value as Filtro["comprou"] })}>
                <option value="">Tanto faz</option>
                <option value="nao">Só quem NÃO comprou</option>
                <option value="sim">Só quem JÁ comprou</option>
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-3 text-sm">
              <input type="checkbox" checked={Boolean(f.pix_pendente)} onChange={(e) => setF({ pix_pendente: e.target.checked })} className="accent-[#5ed98c]" />
              Gerou Pix e não pagou
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] text-suave">
              Conversou nos últimos (dias)
              <input type="number" min={0} className={inputCls} value={f.conversou_dias ?? 0} onChange={(e) => setF({ conversou_dias: Math.max(0, Number(e.target.value) || 0) })} />
              <span className="text-[11px]">0 = qualquer data. Contato antigo aumenta o risco de ban.</span>
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] text-suave">
              Sem conversar há pelo menos (horas)
              <input type="number" min={0} className={inputCls} value={f.parado_horas ?? 0} onChange={(e) => setF({ parado_horas: Math.max(0, Number(e.target.value) || 0) })} />
              <span className="text-[11px]">Evita mandar para quem está conversando agora.</span>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(f.incluir_pausados)} onChange={(e) => setF({ incluir_pausados: e.target.checked })} className="accent-[#5ed98c]" />
            Incluir conversas com o robô pausado (atendidas por você)
          </label>
          <p className="text-[11px] text-suave">Quem respondeu SAIR (etiqueta “Não perturbe”) nunca entra.</p>

          <details className="rounded-xl border border-borda bg-fundo p-3">
            <summary className="cursor-pointer text-sm font-semibold">Ritmo e proteção contra ban</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-[13px] text-suave">
                Intervalo mínimo (seg)
                <input type="number" min={10} className={inputCls} value={c.intervalo_min_seg} onChange={(e) => setC({ ...c, intervalo_min_seg: Number(e.target.value) || 10 })} />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] text-suave">
                Intervalo máximo (seg)
                <input type="number" min={10} className={inputCls} value={c.intervalo_max_seg} onChange={(e) => setC({ ...c, intervalo_max_seg: Number(e.target.value) || 10 })} />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] text-suave">
                Máximo por chip por dia
                <input type="number" min={1} className={inputCls} value={c.limite_diario_chip} onChange={(e) => setC({ ...c, limite_diario_chip: Number(e.target.value) || 1 })} />
              </label>
              <div className="flex flex-col gap-1.5 text-[13px] text-suave">
                Horário de envio (Brasília)
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={23} aria-label="Hora de início" className={inputCls} value={c.janela_inicio} onChange={(e) => setC({ ...c, janela_inicio: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })} />
                  <span>às</span>
                  <input type="number" min={1} max={24} aria-label="Hora de fim" className={inputCls} value={c.janela_fim} onChange={(e) => setC({ ...c, janela_fim: Math.min(24, Math.max(1, Number(e.target.value) || 1)) })} />
                </div>
              </div>
            </div>
            {publico ? (
              <p className="mt-3 text-xs text-suave">
                Com esse ritmo, {publico} contato(s) levam cerca de <b className="text-texto">{duracao(publico, c.intervalo_min_seg, c.intervalo_max_seg)}</b> (só dentro do horário).
              </p>
            ) : null}
          </details>
        </div>
      </div>

      {erro && <p className="text-sm text-vermelho">{erro}</p>}

      {confirmar ? (
        <div className="flex flex-col gap-3 rounded-xl border border-[#5a4220] bg-[#241b0e] p-4 text-sm">
          <span>
            Enviar para <b>{publico}</b> contato(s) agora? As mensagens saem aos poucos, uma a cada {c.intervalo_min_seg}–{c.intervalo_max_seg}s, entre {c.janela_inicio}h e {c.janela_fim}h. Você pode pausar a qualquer momento.
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={salvando} onClick={() => salvar(true)} className="min-h-10 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo disabled:opacity-60">
              {salvando ? "Iniciando…" : "Sim, iniciar disparo"}
            </button>
            <button type="button" onClick={() => setConfirmar(false)} className="min-h-10 rounded-[10px] border border-borda bg-cartao px-4 text-sm">
              Voltar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={salvando || !publico}
            onClick={() => setConfirmar(true)}
            className="min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-50"
          >
            Iniciar disparo
          </button>
          <button type="button" disabled={salvando} onClick={() => salvar(false)} className="min-h-11 rounded-[10px] border border-borda bg-cartao px-4 text-sm hover:bg-elevado">
            Salvar rascunho
          </button>
          <button type="button" onClick={onFechar} className="min-h-11 rounded-[10px] px-4 text-sm text-suave hover:text-texto">
            Cancelar
          </button>
        </div>
      )}
    </Card>
  );
}

export function DisparosCliente() {
  const [campanhas, setCampanhas] = useState<Campanha[] | null>(null);
  const [respostas, setRespostas] = useState<Record<string, number>>({});
  const [colunas, setColunas] = useState<Opcao[]>([]);
  const [etiquetas, setEtiquetas] = useState<Opcao[]>([]);
  const [funis, setFunis] = useState<Opcao[]>([]);
  const [editando, setEditando] = useState<(typeof NOVA & { id?: string }) | null>(null);
  const [chips, setChips] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const supabase = createClient();
    const [c, r] = await Promise.all([
      supabase.from("campanhas").select(CAMPOS).order("criado_em", { ascending: false }),
      supabase.from("campanha_envios").select("campanha_id").not("respondeu_em", "is", null).limit(20000),
    ]);
    if (c.error) setErro("Não consegui carregar os disparos.");
    else setCampanhas(c.data as Campanha[]);
    const cont: Record<string, number> = {};
    for (const x of (r.data ?? []) as { campanha_id: string }[]) cont[x.campanha_id] = (cont[x.campanha_id] ?? 0) + 1;
    setRespostas(cont);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao abrir a página
    void carregar();
    const supabase = createClient();
    void Promise.all([
      supabase.from("kanban_colunas").select("id, nome").order("ordem"),
      supabase.from("etiquetas").select("nome").order("nome"),
      supabase.from("funis").select("id, nome").order("nome"),
      supabase.from("numeros").select("id", { count: "exact", head: true }).eq("status", "conectado"),
      supabase.from("contatos").select("etiquetas").eq("simulacao", false).limit(2000),
    ]).then(([k, e, f, n, ct]) => {
      setColunas((k.data ?? []) as Opcao[]);
      // etiquetas cadastradas + as que o robô colocou direto nos contatos
      const nomes = new Set<string>(((e.data ?? []) as { nome: string }[]).map((x) => x.nome));
      for (const linha of (ct.data ?? []) as { etiquetas: string[] | null }[]) for (const t of linha.etiquetas ?? []) nomes.add(t);
      nomes.delete("Não perturbe");
      setEtiquetas([...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")).map((x) => ({ id: x, nome: x })));
      setFunis((f.data ?? []) as Opcao[]);
      setChips(n.count ?? 0);
    });
    const canal = supabase
      .channel("campanhas")
      .on("postgres_changes", { event: "*", schema: "public", table: "campanhas" }, () => void carregar())
      .subscribe();
    const t = setInterval(() => void carregar(), 30_000);
    return () => {
      clearInterval(t);
      void supabase.removeChannel(canal);
    };
  }, [carregar]);

  async function mudar(cp: Campanha, acao: "pausar" | "retomar" | "cancelar" | "apagar") {
    setErro(null);
    const supabase = createClient();
    const r =
      acao === "pausar"
        ? await supabase.from("campanhas").update({ status: "pausada" }).eq("id", cp.id)
        : acao === "cancelar"
          ? await supabase.from("campanhas").update({ status: "cancelada", proximo_envio_em: null }).eq("id", cp.id)
          : acao === "apagar"
            ? await supabase.from("campanhas").delete().eq("id", cp.id)
            : await supabase.rpc("iniciar_campanha", { p_id: cp.id });
    if (r.error) setErro(r.error.message);
    void carregar();
  }

  const ativos = useMemo(() => campanhas?.filter((c) => c.status === "enviando").length ?? 0, [campanhas]);

  return (
    <>
      <PageHeader
        title="Disparos"
        subtitle="Mande uma mensagem para uma lista do CRM, com ritmo seguro para não tomar ban"
        actions={
          !editando && (
            <button type="button" onClick={() => setEditando({ ...NOVA, filtro: { ...NOVA.filtro } })} className="min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110">
              + Novo disparo
            </button>
          )
        }
      />

      {chips === 0 && (
        <p className="rounded-xl border border-[#5a4220] bg-[#241b0e] px-4 py-3 text-sm text-laranja">
          Nenhum chip conectado agora: os disparos ficam parados. Conecte em <Link href="/numeros" className="underline">Números</Link>.
        </p>
      )}
      {erro && <p className="text-sm text-vermelho">{erro}</p>}

      {editando && (
        <Editor
          inicial={editando}
          colunas={colunas}
          etiquetas={etiquetas}
          funis={funis}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null);
            void carregar();
          }}
        />
      )}

      <Card title={ativos ? `Seus disparos · ${ativos} enviando agora` : "Seus disparos"}>
        {campanhas === null && !erro && <p className="text-sm text-suave">Carregando…</p>}
        {campanhas?.length === 0 && (
          <EmptyState
            title="Nenhum disparo ainda"
            text="Crie um disparo para recuperar quem gerou Pix e não pagou, oferecer um produto novo para quem já comprou ou reativar contatos parados."
          />
        )}
        {campanhas && campanhas.length > 0 && (
          <ul className="flex flex-col divide-y divide-borda">
            {campanhas.map((cp) => {
              const pct = cp.total ? Math.round(((cp.enviados + cp.falhas) / cp.total) * 100) : 0;
              const st = STATUS[cp.status];
              return (
                <li key={cp.id} className="flex flex-col gap-2.5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{cp.nome}</span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${st.c}`}>{st.t}</span>
                    {cp.status === "enviando" && (
                      <button type="button" onClick={() => mudar(cp, "pausar")} className="min-h-9 rounded-lg px-2 text-xs text-laranja hover:underline">
                        Pausar
                      </button>
                    )}
                    {cp.status === "pausada" && (
                      <button type="button" onClick={() => mudar(cp, "retomar")} className="min-h-9 rounded-lg px-2 text-xs text-limao hover:underline">
                        Retomar
                      </button>
                    )}
                    {cp.status === "rascunho" && (
                      <button
                        type="button"
                        onClick={() => setEditando({ ...cp, filtro: { ...NOVA.filtro, ...cp.filtro } })}
                        className="min-h-9 rounded-lg px-2 text-xs text-texto hover:underline"
                      >
                        Editar
                      </button>
                    )}
                    {(cp.status === "enviando" || cp.status === "pausada") && (
                      <button type="button" onClick={() => mudar(cp, "cancelar")} className="min-h-9 rounded-lg px-2 text-xs text-suave hover:text-vermelho">
                        Cancelar
                      </button>
                    )}
                    {(cp.status === "rascunho" || cp.status === "concluida" || cp.status === "cancelada") && (
                      <button type="button" onClick={() => mudar(cp, "apagar")} className="min-h-9 rounded-lg px-2 text-xs text-suave hover:text-vermelho">
                        Apagar
                      </button>
                    )}
                  </div>
                  {cp.status !== "rascunho" && (
                    <>
                      <div className="h-2 overflow-hidden rounded-full bg-elevado">
                        <div className="h-full rounded-full bg-limao transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-suave">
                        <span>
                          <b className="text-texto">{cp.enviados}</b> de {cp.total} enviados
                        </span>
                        <span>
                          <b className="text-texto">{respostas[cp.id] ?? 0}</b> responderam
                          {cp.enviados > 0 && ` (${Math.round(((respostas[cp.id] ?? 0) / cp.enviados) * 100)}%)`}
                        </span>
                        {cp.falhas > 0 && <span className="text-vermelho">{cp.falhas} falharam</span>}
                        {cp.status === "enviando" && cp.proximo_envio_em && (
                          <span>próximo envio {new Date(cp.proximo_envio_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                        )}
                      </div>
                    </>
                  )}
                  <p className="line-clamp-2 text-xs text-suave">{cp.mensagem}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Boas práticas para não tomar ban">
        <ul className="flex flex-col gap-1.5 text-sm text-suave">
          <li>• Mande só para quem já conversou com você, de preferência nos últimos 30 dias.</li>
          <li>• Use variações na mensagem ({"{Oi|Olá}"}) e mantenha o intervalo de pelo menos 45 segundos.</li>
          <li>• Comece com poucos contatos por dia num chip novo e vá aumentando.</li>
          <li>• Deixe o “responda SAIR” ligado: quem pede para sair nunca mais recebe.</li>
        </ul>
      </Card>
    </>
  );
}
