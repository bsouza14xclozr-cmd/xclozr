"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

type Prefs = { ativo: boolean; tipos: string[]; resumo_hora: number };
type Aparelho = { id: string; endpoint: string; aparelho: string | null; criado_em: string; ultimo_envio: string | null; erro: string | null };

const TIPOS: { id: string; nome: string; desc: string }[] = [
  { id: "venda", nome: "💰 Vendas", desc: "Cada Pix pago, na hora" },
  { id: "lead", nome: "💬 Novo lead", desc: "Toda vez que uma pessoa nova chama no WhatsApp (com o anúncio de onde veio)" },
  { id: "chip", nome: "📵 Chip caiu", desc: "Quando um número desconecta ou é banido" },
  { id: "humano", nome: "🙋 Cliente chamando você", desc: "Quando o funil passa a conversa para você" },
  { id: "trafego", nome: "📈 Anúncios", desc: "Relatório do agente de tráfego, regras que pausaram/escalaram e token do Meta" },
  { id: "resumo", nome: "📊 Resumo do dia", desc: "Conversas, vendas, gasto, lucro e custo por venda" },
  { id: "funil", nome: "⚠️ Problemas no funil", desc: "Bloco sem produto, Pix que não gerou, etc." },
  { id: "info", nome: "🔔 Outros avisos", desc: "Demais avisos do sininho" },
];
const PADRAO: Prefs = { ativo: true, tipos: TIPOS.map((t) => t.id), resumo_hora: 21 };

function chaveParaBytes(b64: string) {
  const p = "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function nomeAparelho() {
  const ua = navigator.userAgent;
  const so = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Computador";
  const nav = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "navegador";
  return `${so} · ${nav}`;
}
async function erroDe(error: unknown, padrao: string) {
  try {
    const j = await (error as { context?: Response }).context?.json();
    return String(j?.erro || padrao);
  } catch {
    return padrao;
  }
}

export function NotificacoesCliente() {
  const [suporte, setSuporte] = useState<"sim" | "nao" | "ios-instalar" | null>(null);
  const [permissao, setPermissao] = useState<NotificationPermission | null>(null);
  const [inscritoAqui, setInscritoAqui] = useState<string | null>(null);
  const [instalavel, setInstalavel] = useState(false);
  const [instalado, setInstalado] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(PADRAO);
  const [aparelhos, setAparelhos] = useState<Aparelho[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const supabase = createClient();
    const [p, a] = await Promise.all([
      supabase.from("notif_prefs").select("ativo, tipos, resumo_hora").maybeSingle(),
      supabase.from("push_inscricoes").select("id, endpoint, aparelho, criado_em, ultimo_envio, erro").order("criado_em", { ascending: false }),
    ]);
    if (p.data) setPrefs(p.data as Prefs);
    setAparelhos((a.data ?? []) as Aparelho[]);
  }, []);

  useEffect(() => {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê o que o aparelho suporta ao abrir
    setInstalado(standalone);
    const tem = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSuporte(tem ? "sim" : ios && !standalone ? "ios-instalar" : "nao");
    if ("Notification" in window) setPermissao(Notification.permission);
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.ready.then((r) => r.pushManager?.getSubscription()).then((s) => setInscritoAqui(s?.endpoint ?? null));
    setInstalavel(Boolean(window.__xclozrInstalar));
    const ev = () => setInstalavel(true);
    window.addEventListener("xclozr-instalavel", ev);
    void carregar();
    return () => window.removeEventListener("xclozr-instalavel", ev);
  }, [carregar]);

  async function rodar(fn: () => Promise<string | void>) {
    setMsg(null);
    setOcupado(true);
    try {
      const t = await fn();
      if (t) setMsg({ ok: true, texto: t });
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  const ativar = () =>
    rodar(async () => {
      const perm = await Notification.requestPermission();
      setPermissao(perm);
      if (perm !== "granted") throw new Error("Você não permitiu as notificações. Libere nas configurações do navegador (ícone de cadeado ao lado do endereço) e tente de novo.");
      const supabase = createClient();
      const { data: ch, error } = await supabase.functions.invoke("notificar/chave", { method: "GET" });
      if (error || !ch?.chave) throw new Error("Não consegui falar com o servidor de notificações. Tente de novo.");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(ch.chave) });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const { error: e2 } = await supabase
        .from("push_inscricoes")
        .upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, aparelho: nomeAparelho() }, { onConflict: "endpoint" });
      if (e2) throw new Error("Não consegui salvar este aparelho. Tente de novo.");
      await supabase.from("notif_prefs").upsert({ ...prefs }, { onConflict: "dono_id", ignoreDuplicates: true });
      setInscritoAqui(j.endpoint);
      await carregar();
      const { error: e3 } = await supabase.functions.invoke("notificar/testar", { body: {} });
      return e3 ? "Notificações ativadas neste aparelho." : "Notificações ativadas! Mandei uma de teste agora.";
    });

  const desativarAqui = () =>
    rodar(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await createClient().from("push_inscricoes").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setInscritoAqui(null);
      await carregar();
      return "Este aparelho não vai mais receber notificações.";
    });

  const testar = () =>
    rodar(async () => {
      const { data, error } = await createClient().functions.invoke("notificar/testar", { body: {} });
      if (error) throw new Error(await erroDe(error, "Não consegui mandar o teste."));
      return `Teste enviado para ${data?.aparelhos ?? 1} aparelho(s).`;
    });

  async function salvarPrefs(p: Prefs) {
    setPrefs(p);
    const { error } = await createClient()
      .from("notif_prefs")
      .upsert({ ...p, atualizado_em: new Date().toISOString() }, { onConflict: "dono_id" });
    if (error) setMsg({ ok: false, texto: "Não consegui salvar a preferência." });
  }

  const instalar = () =>
    rodar(async () => {
      const ev = window.__xclozrInstalar;
      if (!ev) return;
      await ev.prompt();
      const r = await ev.userChoice;
      window.__xclozrInstalar = null;
      setInstalavel(false);
      if (r.outcome === "accepted") {
        setInstalado(true);
        return "App instalado! Ele aparece na tela inicial com o ícone do XClozr.";
      }
    });

  const removerAparelho = (id: string) =>
    rodar(async () => {
      await createClient().from("push_inscricoes").delete().eq("id", id);
      await carregar();
      return "Aparelho removido.";
    });

  const cartao = "flex flex-col gap-3 rounded-2xl border border-borda bg-cartao p-5";
  return (
    <>
      <PageHeader title="App e notificações" subtitle="Instale o XClozr no celular e receba vendas, chip caído e alertas na hora" />

      <section className={cartao}>
        <h2 className="text-base font-semibold">1. Instalar o app</h2>
        {instalado ? (
          <p className="text-sm text-limao">✓ Você está usando o app instalado.</p>
        ) : (
          <>
            {instalavel && (
              <button type="button" onClick={() => void instalar()} disabled={ocupado} className="min-h-11 self-start rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60">
                📲 Instalar o XClozr
              </button>
            )}
            <ul className="flex flex-col gap-1.5 text-sm text-suave">
              <li>
                <b className="text-texto">Android (Chrome):</b> toque em {instalavel ? "“Instalar o XClozr” acima" : "⋮ (canto de cima) → “Instalar app” ou “Adicionar à tela inicial”"}.
              </li>
              <li>
                <b className="text-texto">iPhone (Safari):</b> toque em <b className="text-texto">Compartilhar</b> (quadrado com seta) → <b className="text-texto">Adicionar à Tela de Início</b>. Depois abra
                o XClozr pelo ícone e volte aqui para ativar as notificações. No iPhone elas só funcionam com o app instalado (iOS 16.4 ou mais novo).
              </li>
              <li>
                <b className="text-texto">Computador (Chrome/Edge):</b> clique no ícone de instalar na barra de endereço, ou só ative as notificações abaixo.
              </li>
            </ul>
          </>
        )}
      </section>

      <section className={cartao}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">2. Notificações neste aparelho</h2>
          {inscritoAqui && permissao === "granted" ? (
            <span className="rounded-full bg-limao/15 px-2.5 py-1 text-xs font-semibold text-limao">● Ativadas aqui</span>
          ) : (
            <span className="rounded-full border border-[#5a4220] bg-[#241b0e] px-2.5 py-1 text-xs font-semibold text-laranja">● Desativadas aqui</span>
          )}
        </div>
        {suporte === "ios-instalar" && <p className="text-sm text-laranja">No iPhone, instale o app primeiro (passo 1) e abra pelo ícone da tela inicial para ativar.</p>}
        {suporte === "nao" && <p className="text-sm text-laranja">Este navegador não aceita notificações. Use o Chrome (Android/computador) ou o app instalado no iPhone.</p>}
        {permissao === "denied" && (
          <p className="text-sm text-laranja">As notificações estão bloqueadas neste navegador. Libere em: cadeado ao lado do endereço → Notificações → Permitir. Depois toque em Ativar.</p>
        )}
        {suporte === "sim" && (
          <div className="flex flex-wrap gap-2">
            {!(inscritoAqui && permissao === "granted") ? (
              <button type="button" onClick={() => void ativar()} disabled={ocupado} className="min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60">
                {ocupado ? "Ativando…" : "🔔 Ativar notificações aqui"}
              </button>
            ) : (
              <>
                <button type="button" onClick={() => void testar()} disabled={ocupado} className="min-h-11 rounded-[10px] border border-limao/50 px-4 text-sm font-semibold text-limao hover:bg-limao/10 disabled:opacity-60">
                  Mandar notificação de teste
                </button>
                <button type="button" onClick={() => void desativarAqui()} disabled={ocupado} className="min-h-11 rounded-[10px] border border-borda px-4 text-sm text-suave hover:bg-elevado disabled:opacity-60">
                  Desativar aqui
                </button>
              </>
            )}
          </div>
        )}
        {msg && <p className={`text-sm ${msg.ok ? "text-limao" : "text-vermelho"}`}>{msg.texto}</p>}
      </section>

      <section className={cartao}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">3. O que você quer receber</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-limao" checked={prefs.ativo} onChange={(e) => void salvarPrefs({ ...prefs, ativo: e.target.checked })} />
            Notificações ligadas
          </label>
        </div>
        <div className={`grid gap-2 sm:grid-cols-2 ${prefs.ativo ? "" : "opacity-50"}`}>
          {TIPOS.map((t) => {
            const on = prefs.tipos.includes(t.id);
            return (
              <label key={t.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${on ? "border-limao/40 bg-limao/5" : "border-borda"}`}>
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 accent-limao"
                  checked={on}
                  disabled={!prefs.ativo}
                  onChange={(e) => void salvarPrefs({ ...prefs, tipos: e.target.checked ? [...prefs.tipos, t.id] : prefs.tipos.filter((x) => x !== t.id) })}
                />
                <span className="flex flex-col">
                  <span className="font-medium">{t.nome}</span>
                  <span className="text-xs text-suave">{t.desc}</span>
                </span>
              </label>
            );
          })}
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm text-suave">
          Mandar o resumo do dia às
          <select
            className="min-h-10 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto"
            value={prefs.resumo_hora}
            onChange={(e) => void salvarPrefs({ ...prefs, resumo_hora: Number(e.target.value) })}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          (horário de Brasília)
        </label>
      </section>

      <section className={cartao}>
        <h2 className="text-base font-semibold">Aparelhos que recebem</h2>
        {aparelhos.length === 0 ? (
          <p className="text-sm text-suave">Nenhum ainda. Ative no celular e no computador que você usa.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-borda">
            {aparelhos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">
                    {a.aparelho ?? "Aparelho"} {a.endpoint === inscritoAqui && <span className="text-xs text-limao">(este)</span>}
                  </span>
                  <span className="text-xs text-suave">
                    desde {new Date(a.criado_em).toLocaleDateString("pt-BR")}
                    {a.ultimo_envio ? ` · última notificação ${new Date(a.ultimo_envio).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}
                    {a.erro ? ` · erro: ${a.erro}` : ""}
                  </span>
                </span>
                <button type="button" onClick={() => void removerAparelho(a.id)} className="text-xs text-suave hover:text-vermelho">
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
