"use client";

// "Minha voz": grava ~1 minuto falando livremente (ou envia um áudio) e clona a voz para os áudios do robô.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Modelo = "natural" | "qualidade" | "economia";
type Status = { conectado: boolean; voz_pronta?: boolean; voz_nome?: string | null; modelo?: Modelo; plano?: string | null; erro?: string | null };

const inputCls =
  "w-full min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto placeholder:text-suave/70 focus:border-limao focus:outline-none";
const IDEAL = 60;
const MINIMO = 30;
const MAXIMO = 180;

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke("voz", { body: corpo });
  if (error) {
    let msg = "Algo deu errado.";
    try {
      const j = await (error as { context?: Response }).context?.json();
      if (j?.erro) msg = j.erro;
    } catch {
      /* sem corpo */
    }
    throw new Error(msg);
  }
  return data as T;
}

function tempo(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function MinhaVoz() {
  const [status, setStatus] = useState<Status | null>(null);
  const [apikey, setApikey] = useState("");
  const [trocarChave, setTrocarChave] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duracao, setDuracao] = useState(0);
  const [consentimento, setConsentimento] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [textoPrevia, setTextoPrevia] = useState("[warmly] Oi! Tudo bem? Vi que você chamou aqui... [laughs softly] já te explico tudinho, tá?");
  const [lado, setLado] = useState<{ natural: string; classica: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const relogio = useRef<ReturnType<typeof setInterval> | null>(null);
  const inicio = useRef(0);

  const carregar = useCallback(async () => {
    try {
      setStatus(await chamar<Status>({ acao: "status" }));
    } catch {
      setStatus({ conectado: false });
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao abrir
    void carregar();
    return () => {
      if (relogio.current) clearInterval(relogio.current);
      gravador.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, [carregar]);

  async function rodar(qual: string, fn: () => Promise<string | void>) {
    setMsg(null);
    setOcupado(qual);
    try {
      const t = await fn();
      if (t) setMsg({ ok: true, texto: t });
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message });
    } finally {
      setOcupado(null);
    }
  }

  function usarAudio(b: Blob, seg: number) {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudio(b);
    setAudioUrl(URL.createObjectURL(b));
    setDuracao(seg);
  }

  async function comecar() {
    setMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const tipo = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      pedacos.current = [];
      r.ondataavailable = (e) => e.data.size && pedacos.current.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const seg = (Date.now() - inicio.current) / 1000;
        usarAudio(new Blob(pedacos.current, { type: r.mimeType || "audio/webm" }), seg);
      };
      gravador.current = r;
      inicio.current = Date.now();
      r.start(1000);
      setGravando(true);
      setSegundos(0);
      relogio.current = setInterval(() => {
        const s = (Date.now() - inicio.current) / 1000;
        setSegundos(s);
        if (s >= MAXIMO) parar();
      }, 250);
    } catch {
      setMsg({ ok: false, texto: "Não consegui acessar o microfone. Permita o microfone para este site (cadeado ao lado do endereço) e tente de novo." });
    }
  }

  function parar() {
    if (relogio.current) clearInterval(relogio.current);
    relogio.current = null;
    setGravando(false);
    if (gravador.current?.state === "recording") gravador.current.stop();
  }

  function escolherArquivo(f: File | undefined) {
    if (!f) return;
    const el = new Audio(URL.createObjectURL(f));
    el.onloadedmetadata = () => usarAudio(f, Number.isFinite(el.duration) ? el.duration : IDEAL);
    el.onerror = () => usarAudio(f, IDEAL);
  }

  const clonar = () =>
    rodar("clonar", async () => {
      if (!audio) throw new Error("Grave ou envie o áudio primeiro.");
      const ext = audio.type.includes("mp4") ? "m4a" : audio.type.includes("mpeg") ? "mp3" : audio.type.includes("wav") ? "wav" : audio.type.includes("ogg") ? "ogg" : "webm";
      const form = new FormData();
      form.append("audio", new File([audio], `minha-voz.${ext}`, { type: audio.type || "audio/webm" }));
      form.append("consentimento", consentimento ? "sim" : "nao");
      const { data, error } = await createClient().functions.invoke("voz/clonar", { body: form });
      if (error) {
        let m = "Não consegui clonar a voz.";
        try {
          const j = await (error as { context?: Response }).context?.json();
          if (j?.erro) m = j.erro;
        } catch {
          /* sem corpo */
        }
        throw new Error(m);
      }
      setPrevia((data as { previa?: string | null })?.previa ?? null);
      setAudio(null);
      await carregar();
      return "Pronto! Sua voz foi clonada. Ouça a prévia abaixo.";
    });

  const salvarChave = (e: React.FormEvent) => {
    e.preventDefault();
    void rodar("chave", async () => {
      const r = await chamar<{ aviso?: string | null }>({ acao: "chave", apikey, modelo: status?.modelo ?? "qualidade" });
      setApikey("");
      setTrocarChave(false);
      await carregar();
      return r.aviso ?? "ElevenLabs conectada! Agora grave sua voz.";
    });
  };

  const ouvir = () =>
    rodar("previa", async () => {
      const r = await chamar<{ url: string }>({ acao: "previa", texto: textoPrevia });
      setPrevia(`${r.url}?t=${Date.now()}`);
      setLado(null);
    });

  const comparar = () =>
    rodar("comparar", async () => {
      const r = await chamar<{ natural: string; classica: string }>({ acao: "previa", texto: textoPrevia, comparar: true });
      const t = Date.now();
      setLado({ natural: `${r.natural}?t=${t}`, classica: `${r.classica}?t=${t}` });
      setPrevia(null);
    });

  const remover = () =>
    rodar("remover", async () => {
      if (!window.confirm("Apagar sua voz clonada? Os áudios com sua voz nos funis passam a ir como texto até você clonar de novo.")) return;
      await chamar({ acao: "remover" });
      setPrevia(null);
      await carregar();
      return "Voz apagada.";
    });

  const trocarModelo = (modelo: Modelo) =>
    rodar("modelo", async () => {
      await chamar({ acao: "modelo", modelo });
      setStatus((s) => (s ? { ...s, modelo } : s));
    });

  if (!status) return null;
  const pct = Math.min(100, (segundos / IDEAL) * 100);
  const curto = duracao > 0 && duracao < MINIMO;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-borda bg-cartao p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">🎙️ Minha voz</h2>
          <p className="text-xs text-suave">Grave 1 minuto falando do seu jeito e o robô passa a mandar áudios com a sua voz (item “Áudio com minha voz” no bloco Mensagem).</p>
        </div>
        {status.voz_pronta ? (
          <span className="rounded-full bg-limao/15 px-2.5 py-1 text-xs font-semibold text-limao">● Voz pronta</span>
        ) : (
          <span className="rounded-full border border-[#5a4220] bg-[#241b0e] px-2.5 py-1 text-xs font-semibold text-laranja">● Sem voz ainda</span>
        )}
      </div>

      {/* 1. chave */}
      {!status.conectado || trocarChave ? (
        <form onSubmit={salvarChave} className="flex flex-col gap-2 rounded-xl border border-borda bg-fundo p-4">
          <span className="text-sm font-medium">1. Conectar a ElevenLabs (quem faz a clonagem)</span>
          <span className="text-xs text-suave">
            Em elevenlabs.io → seu perfil → <b className="text-texto">API Keys</b> → Create. Precisa do plano <b className="text-texto">Starter</b> ou maior para clonar voz.
          </span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input className={inputCls} type="password" value={apikey} onChange={(e) => setApikey(e.target.value)} placeholder="Cole a chave de API (sk_…)" autoComplete="off" required />
            <button type="submit" disabled={ocupado !== null} className="min-h-11 shrink-0 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60">
              {ocupado === "chave" ? "Testando…" : "Conectar"}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-xs text-suave">
          <span>ElevenLabs conectada{status.plano ? ` (plano ${status.plano})` : ""}.</span>
          <button type="button" onClick={() => setTrocarChave(true)} className="text-limao hover:underline">
            Trocar chave
          </button>
          <label className="flex items-center gap-1.5">
            Qualidade:
            <select className="min-h-8 rounded-lg border border-borda bg-fundo px-2 text-xs text-texto" value={status.modelo ?? "qualidade"} onChange={(e) => void trocarModelo(e.target.value as Modelo)}>
              <option value="natural">Mais humana (v4, com emoção)</option>
              <option value="qualidade">Clássica (v2)</option>
              <option value="economia">Econômica (metade dos créditos)</option>
            </select>
          </label>
        </div>
      )}
      {status.erro && <p className="text-sm text-laranja">{status.erro}</p>}

      {/* 2. gravar */}
      {status.conectado && !trocarChave && (
        <div className="flex flex-col gap-3 rounded-xl border border-borda bg-fundo p-4">
          <span className="text-sm font-medium">{status.voz_pronta ? "Gravar de novo (substitui a voz atual)" : "2. Gravar sua voz"}</span>
          <ul className="flex flex-col gap-1 text-xs text-suave">
            <li>• Fale do seu jeito por cerca de <b className="text-texto">1 minuto</b>, como se estivesse mandando áudio para um cliente. Não precisa ler nada.</li>
            <li>• Lugar silencioso, celular a um palmo da boca, sem música ou TV ao fundo.</li>
            <li>• Varie um pouco: explique o produto, faça uma pergunta, dê risada se for natural. Quanto mais natural, mais parecido fica.</li>
          </ul>

          {gravando ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 animate-pulse rounded-full bg-vermelho" aria-hidden />
                <b className="font-titulo text-2xl tabular-nums">{tempo(segundos)}</b>
                <span className="text-xs text-suave">{segundos < MINIMO ? `mínimo ${MINIMO}s` : segundos < IDEAL ? "ótimo, continue até 1 minuto" : "perfeito! pode parar"}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-elevado">
                <div className={`h-full rounded-full ${segundos >= IDEAL ? "bg-limao" : "bg-laranja"}`} style={{ width: `${pct}%` }} />
              </div>
              <button type="button" onClick={parar} className="min-h-11 self-start rounded-[10px] bg-vermelho px-5 text-sm font-bold text-fundo hover:brightness-110">
                ■ Parar
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void comecar()} disabled={ocupado !== null} className="min-h-11 rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-60">
                ● {audio ? "Gravar de novo" : "Começar a gravar"}
              </button>
              <label className="min-h-11 cursor-pointer rounded-[10px] border border-borda px-4 py-3 text-sm text-suave hover:bg-elevado">
                ou enviar um áudio
                <input type="file" accept="audio/*" className="sr-only" onChange={(e) => escolherArquivo(e.target.files?.[0])} />
              </label>
            </div>
          )}

          {audioUrl && audio && !gravando && (
            <div className="flex flex-col gap-2">
              <audio src={audioUrl} controls className="w-full" />
              <span className={`text-xs ${curto ? "text-laranja" : "text-suave"}`}>
                Duração: {tempo(duracao)}
                {curto ? ` — curto demais, grave pelo menos ${MINIMO} segundos (o ideal é 1 minuto).` : ""}
              </span>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-5 w-5 accent-limao" checked={consentimento} onChange={(e) => setConsentimento(e.target.checked)} />
                <span>
                  Confirmo que <b>esta voz é minha</b> e autorizo criar uma cópia dela para os áudios do meu robô de vendas.
                </span>
              </label>
              <button
                type="button"
                onClick={() => void clonar()}
                disabled={!consentimento || curto || ocupado !== null}
                className="min-h-11 self-start rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-50"
              >
                {ocupado === "clonar" ? "Clonando sua voz… (até 1 minuto)" : "✨ Clonar minha voz"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 3. testar */}
      {status.voz_pronta && !trocarChave && (
        <div className="flex flex-col gap-2 rounded-xl border border-borda bg-fundo p-4">
          <span className="text-sm font-medium">Ouvir como fica</span>
          <textarea rows={2} className={`${inputCls} py-2`} value={textoPrevia} onChange={(e) => setTextoPrevia(e.target.value)} maxLength={400} aria-label="Texto para ouvir com sua voz" />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void ouvir()} disabled={ocupado !== null} className="min-h-10 rounded-[10px] border border-limao/50 px-4 text-sm font-semibold text-limao hover:bg-limao/10 disabled:opacity-60">
              {ocupado === "previa" ? "Gerando…" : "▶ Ouvir com minha voz"}
            </button>
            <button type="button" onClick={() => void comparar()} disabled={ocupado !== null} className="min-h-10 rounded-[10px] border border-borda px-4 text-sm font-semibold text-texto hover:border-limao/50 disabled:opacity-60">
              {ocupado === "comparar" ? "Gerando os dois…" : "⚖️ Comparar v4 × v2"}
            </button>
            <button type="button" onClick={() => void remover()} disabled={ocupado !== null} className="min-h-10 rounded-[10px] px-3 text-xs text-suave hover:text-vermelho">
              Apagar minha voz
            </button>
          </div>
          {previa && <audio key={previa} src={previa} controls autoPlay className="w-full" />}
          {lado && (
            <div className="grid gap-3 sm:grid-cols-2">
              {([["natural", "Mais humana (v4)"], ["classica", "Clássica (v2)"]] as const).map(([k, rotulo]) => (
                <div key={k} className="flex flex-col gap-1.5 rounded-lg border border-borda p-3">
                  <span className="text-xs font-semibold">{rotulo}</span>
                  <audio src={lado[k]} controls className="w-full" />
                  <button type="button" disabled={ocupado !== null || status.modelo === (k === "natural" ? "natural" : "qualidade")} onClick={() => void trocarModelo(k === "natural" ? "natural" : "qualidade")} className="self-start text-xs text-limao hover:underline disabled:text-suave disabled:no-underline">
                    {status.modelo === (k === "natural" ? "natural" : "qualidade") ? "✓ Em uso nos funis" : "Usar esta nos funis"}
                  </button>
                </div>
              ))}
            </div>
          )}
          <span className="text-[11px] text-suave">
            Dica do v4: escreva como você fala (“olha”, “né”, “tá”, reticências pra pausa, preço por extenso) e use etiquetas entre colchetes para emoção:{" "}
            <code className="text-texto">[warmly]</code> carinhoso, <code className="text-texto">[excited]</code> animado, <code className="text-texto">[laughs softly]</code> risadinha,{" "}
            <code className="text-texto">[sighs]</code> suspiro, <code className="text-texto">[whispers]</code> cochicho. Nos outros modelos as etiquetas são ignoradas.
          </span>
          <span className="text-[11px] text-suave">Cada texto novo gasta créditos da ElevenLabs uma vez; textos repetidos reaproveitam o áudio. Com {"{nome}"} no funil, cada cliente gera um áudio.</span>
        </div>
      )}

      {msg && <p className={`text-sm ${msg.ok ? "text-limao" : "text-vermelho"}`}>{msg.texto}</p>}

      <details className="rounded-xl border border-borda bg-fundo p-4" open={!status.voz_pronta ? undefined : true}>
        <summary className="cursor-pointer text-sm font-semibold">📘 Como usar sua voz (passo a passo)</summary>
        <div className="mt-3 flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-1">
            <b>1. Ouvir como ficou (30 segundos)</b>
            <ol className="flex list-decimal flex-col gap-0.5 pl-5 text-suave">
              <li>Em “Ouvir como fica”, escreva uma frase do jeito que você fala com cliente.</li>
              <li>Toque em ▶ Ouvir com minha voz.</li>
              <li>Não gostou? Toque em “Gravar de novo”: fale com mais naturalidade, em lugar silencioso, por 1 minuto inteiro. A voz nova substitui a antiga.</li>
            </ol>
          </div>
          <div className="flex flex-col gap-1">
            <b>2. Colocar no funil</b>
            <ol className="flex list-decimal flex-col gap-0.5 pl-5 text-suave">
              <li>
                Abra um funil em <Link href="/funil" className="text-limao hover:underline">Funis de venda</Link> e clique no bloco Mensagem de boas-vindas.
              </li>
              <li>Clique em + Espera (3 segundos, com “gravando áudio…” marcado) e depois em + 🎙️ Áudio com minha voz.</li>
              <li>
                Escreva, por exemplo: <i className="text-texto">“Oi {"{nome}"}! Que bom que você chamou, vou te mostrar tudo, tá?”</i>
              </li>
              <li>Use ↑ ↓ para deixar a Espera e o áudio onde quiser.</li>
              <li>Clique em ▶ Testar funil, mande “oi” e responda o nome: o áudio aparece com player para você ouvir.</li>
            </ol>
          </div>
          <div className="flex flex-col gap-1">
            <b>3. Testar de verdade no WhatsApp</b>
            <ol className="flex list-decimal flex-col gap-0.5 pl-5 text-suave">
              <li>Deixe o funil ativo e mande “oi” para o número do robô de outro celular.</li>
              <li>Você vê “gravando áudio…” e chega o áudio com a sua voz, como se fosse gravado na hora.</li>
            </ol>
          </div>
          <ul className="flex flex-col gap-0.5 text-xs text-suave">
            <li>• O primeiro áudio de cada texto leva alguns segundos para ser gerado; textos repetidos saem na hora (o áudio é reaproveitado).</li>
            <li>• Com {"{nome}"} cada cliente recebe um áudio com o nome dele (gasta um pouco de crédito por cliente).</li>
            <li>• Se a ElevenLabs falhar (créditos acabaram, chave errada), o robô manda o mesmo texto escrito: a conversa nunca trava.</li>
            <li>• Dica: áudio curto (até 20 segundos) converte mais e gasta menos crédito.</li>
          </ul>
        </div>
      </details>
    </section>
  );
}
