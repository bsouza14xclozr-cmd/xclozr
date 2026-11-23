"use client";

// Conversas: anexar arquivo/mídia e entregar um produto manualmente
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/dinheiro";

const LIMITE = 50 * 1024 * 1024;
const ACEITOS =
  "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/3gpp,video/quicktime,audio/mpeg,audio/mp3,audio/ogg,audio/mp4,audio/aac,audio/wav,audio/x-m4a,audio/webm,application/pdf,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,application/epub+zip";

export type Anexo = { url: string; tipo: "imagem" | "video" | "audio" | "arquivo"; nome: string; tamanho: number };
type Produto = { id: string; nome: string; preco_centavos: number; entrega_tipo: string; entrega_conteudo: string | null };

function tipoDe(mime: string): Anexo["tipo"] {
  if (mime.startsWith("image/")) return "imagem";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "arquivo";
}

const ICONE: Record<Anexo["tipo"], string> = { imagem: "🖼️", video: "🎬", audio: "🎵", arquivo: "📄" };

async function chamarEnvio(corpo: Record<string, unknown>) {
  const { error } = await createClient().functions.invoke("motor/enviar", { body: corpo });
  if (error) {
    let msg = "Não consegui enviar.";
    try {
      const j = await (error as { context?: Response }).context?.json();
      if (j?.erro) msg = j.erro;
    } catch {
      /* sem corpo */
    }
    throw new Error(msg);
  }
}

/** Botão 📎: sobe o arquivo e devolve o anexo pronto para enviar. */
export function BotaoAnexar({ onAnexo, onErro, desativado }: { onAnexo: (a: Anexo) => void; onErro: (m: string) => void; desativado?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [subindo, setSubindo] = useState(false);

  async function escolher(arquivo: File | undefined) {
    if (!arquivo) return;
    if (arquivo.size > LIMITE) return onErro("Arquivo grande demais (máximo 50 MB).");
    if (!ACEITOS.split(",").includes(arquivo.type)) return onErro("Esse tipo de arquivo não é aceito. Use imagem, vídeo, áudio, PDF, Word, Excel, ZIP ou TXT.");
    setSubindo(true);
    try {
      const supabase = createClient();
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("sessão expirada, entre de novo");
      const limpo = arquivo.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "-").slice(-80);
      const caminho = `${u.user.id}/conversas/${crypto.randomUUID().slice(0, 8)}-${limpo}`;
      const { error } = await supabase.storage.from("midias").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
      if (error) throw error;
      onAnexo({ url: supabase.storage.from("midias").getPublicUrl(caminho).data.publicUrl, tipo: tipoDe(arquivo.type), nome: arquivo.name, tamanho: arquivo.size });
    } catch (e) {
      onErro(`Não consegui subir o arquivo: ${(e as Error).message}`);
    } finally {
      setSubindo(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <>
      <input ref={ref} type="file" accept={ACEITOS} className="hidden" onChange={(e) => void escolher(e.target.files?.[0])} />
      <button
        type="button"
        disabled={desativado || subindo}
        onClick={() => ref.current?.click()}
        title="Enviar arquivo, foto, vídeo ou áudio"
        aria-label="Anexar arquivo"
        className="min-h-11 shrink-0 rounded-[10px] border border-borda px-3 text-base hover:bg-elevado disabled:opacity-50"
      >
        {subindo ? "…" : "📎"}
      </button>
    </>
  );
}

export function ChipAnexo({ a, onRemover }: { a: Anexo; onRemover: () => void }) {
  return (
    <div className="flex items-center gap-2 self-start rounded-lg border border-borda bg-elevado px-3 py-1.5 text-xs">
      <span>{ICONE[a.tipo]}</span>
      <span className="max-w-[240px] truncate" title={a.nome}>
        {a.nome}
      </span>
      <span className="text-suave">{(a.tamanho / 1024 / 1024).toFixed(1).replace(".", ",")} MB</span>
      <button type="button" onClick={onRemover} aria-label="Tirar anexo" className="text-suave hover:text-vermelho">
        ✕
      </button>
    </div>
  );
}

export async function enviarAnexo(contatoId: string, a: Anexo, legenda: string, pausar: boolean) {
  await chamarEnvio({ contato_id: contatoId, midia: { url: a.url, tipo: a.tipo, nome: a.nome }, texto: legenda, pausar_robo: pausar });
}

/** Painel 📦: escolhe o produto e entrega na conversa (opcionalmente registrando a venda). */
export function EntregarProduto({ contatoId, pausar, onFeito, onFechar }: { contatoId: string; pausar: boolean; onFeito: (msg: string) => void; onFechar: () => void }) {
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [produtoId, setProdutoId] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [registrar, setRegistrar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void createClient()
      .from("produtos")
      .select("id, nome, preco_centavos, entrega_tipo, entrega_conteudo")
      .eq("ativo", true)
      .order("criado_em", { ascending: false })
      .then(({ data }) => {
        const ps = (data ?? []) as Produto[];
        setProdutos(ps);
        if (ps[0]) setProdutoId(ps[0].id);
      });
  }, []);

  const p = produtos?.find((x) => x.id === produtoId) ?? null;

  async function entregar() {
    if (!p) return;
    setErro(null);
    setEnviando(true);
    try {
      await chamarEnvio({ contato_id: contatoId, produto_id: p.id, texto: mensagem, registrar_venda: registrar, pausar_robo: pausar });
      onFeito(registrar ? `${p.nome} entregue e venda de ${brl(p.preco_centavos)} registrada.` : `${p.nome} entregue.`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-borda bg-lateral p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">📦 Entregar produto</span>
        <button type="button" onClick={onFechar} aria-label="Fechar" className="text-suave hover:text-texto">
          ✕
        </button>
      </div>
      {produtos === null ? (
        <span className="text-xs text-suave">Carregando produtos…</span>
      ) : produtos.length === 0 ? (
        <span className="text-xs text-suave">Nenhum produto ativo. Cadastre em Produtos e Pix.</span>
      ) : (
        <>
          <select
            value={produtoId}
            onChange={(e) => setProdutoId(e.target.value)}
            aria-label="Produto"
            className="min-h-10 rounded-[10px] border border-borda bg-fundo px-3 text-sm"
          >
            {produtos.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nome} · {brl(x.preco_centavos)}
              </option>
            ))}
          </select>
          {p && !p.entrega_conteudo && <span className="text-xs text-laranja">Esse produto não tem arquivo/link de entrega. Cadastre em Produtos e Pix.</span>}
          <textarea
            rows={2}
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            placeholder="Mensagem antes do produto (vazio = a mensagem de entrega cadastrada no produto)"
            aria-label="Mensagem de entrega"
            className="resize-none rounded-[10px] border border-borda bg-fundo px-3 py-2 text-sm placeholder:text-suave/70 focus:border-limao focus:outline-none"
          />
          <label className="flex items-start gap-2 text-xs text-suave">
            <input type="checkbox" checked={registrar} onChange={(e) => setRegistrar(e.target.checked)} className="mt-0.5 accent-[#5ed98c]" />
            <span>
              Registrar como <b className="text-texto">venda paga{p ? ` (${brl(p.preco_centavos)})` : ""}</b>: entra no faturamento e nos relatórios, avisa no celular e encerra a cobrança automática dessa
              pessoa. Use quando ela pagou por fora (Pix direto, dinheiro…).
            </span>
          </label>
          <button
            type="button"
            disabled={enviando || !p?.entrega_conteudo}
            onClick={() => void entregar()}
            className="min-h-10 self-start rounded-[10px] bg-limao px-5 text-sm font-bold text-fundo hover:brightness-110 disabled:opacity-50"
          >
            {enviando ? "Entregando…" : "Entregar agora"}
          </button>
          {erro && <span className="text-sm text-vermelho">{erro}</span>}
        </>
      )}
    </div>
  );
}
