"use client";

// Upload do arquivo do produto (PDF, e-book, planilha…): fica guardado no XClozr e o robô manda pelo WhatsApp quando o Pix cai.
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const LIMITE_MB = 50;
const ACEITA = ".pdf,.epub,.zip,.doc,.docx,.xls,.xlsx,.txt,application/pdf";

function nomeSeguro(n: string) {
  return n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-80);
}
function nomeDaUrl(url: string) {
  const ultimo = decodeURIComponent(url.split("?")[0].split("/").pop() ?? "");
  return ultimo.replace(/^[0-9a-f]{8}-/, "");
}

export function ArquivoProduto({ url, onChange, inputCls }: { url: string; onChange: (url: string) => void; inputCls: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [colar, setColar] = useState(false);
  const ehNosso = url.includes("/storage/v1/object/public/midias/");

  async function enviar(arquivo: File) {
    setErro(null);
    if (arquivo.size > LIMITE_MB * 1024 * 1024) {
      setErro(`Arquivo maior que ${LIMITE_MB} MB. Comprima o PDF (ex.: ilovepdf.com → Comprimir) ou use a opção de colar um link.`);
      return;
    }
    setProgresso(`Enviando ${(arquivo.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB…`);
    try {
      const supabase = createClient();
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("sem usuário");
      const caminho = `${u.user.id}/produtos/${crypto.randomUUID().slice(0, 8)}-${nomeSeguro(arquivo.name)}`;
      const { error } = await supabase.storage.from("midias").upload(caminho, arquivo, { contentType: arquivo.type || "application/pdf", upsert: false });
      if (error) throw error;
      onChange(supabase.storage.from("midias").getPublicUrl(caminho).data.publicUrl);
    } catch {
      setErro("Não consegui enviar o arquivo. Confira se é PDF (ou outro documento) e tente de novo.");
    } finally {
      setProgresso(null);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input ref={ref} type="file" accept={ACEITA} className="hidden" onChange={(e) => e.target.files?.[0] && void enviar(e.target.files[0])} />
      {url && !colar ? (
        <div className="flex items-center gap-3 rounded-[10px] border border-limao/40 bg-limao/5 p-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#3a1d1d] text-[10px] font-bold text-vermelho">
            {(nomeDaUrl(url).split(".").pop() ?? "ARQ").toUpperCase().slice(0, 4)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{nomeDaUrl(url) || "arquivo"}</span>
            <span className="text-[11px] text-suave">{ehNosso ? "Guardado no XClozr · vai como documento no WhatsApp" : "Link externo · vai como documento no WhatsApp"}</span>
          </span>
          <a href={url} target="_blank" rel="noreferrer" className="text-xs text-limao hover:underline">
            Abrir
          </a>
          <button type="button" onClick={() => ref.current?.click()} className="text-xs text-suave hover:text-texto">
            Trocar
          </button>
          <button type="button" onClick={() => onChange("")} className="text-xs text-suave hover:text-vermelho">
            Remover
          </button>
        </div>
      ) : colar ? (
        <div className="flex gap-2">
          <input className={inputCls} value={url} onChange={(e) => onChange(e.target.value.trim())} placeholder="https://…/apostila.pdf" autoFocus />
          <button type="button" onClick={() => setColar(false)} className="min-h-11 shrink-0 rounded-[10px] border border-borda px-3 text-sm hover:bg-elevado">
            OK
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void enviar(f);
          }}
          disabled={progresso !== null}
          className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-[10px] border-2 border-dashed border-borda bg-fundo p-4 text-sm hover:border-limao/60 disabled:opacity-70"
        >
          <span className="text-2xl" aria-hidden>
            📄
          </span>
          <b>{progresso ?? "Enviar o PDF do produto"}</b>
          <span className="text-[11px] text-suave">Toque para escolher ou arraste aqui · até {LIMITE_MB} MB · PDF, e-book, planilha, ZIP</span>
        </button>
      )}
      {!colar && (
        <button type="button" onClick={() => setColar(true)} className="self-start text-[11px] text-suave hover:text-texto">
          {url ? "Usar um link em vez do arquivo" : "Prefiro colar um link (Google Drive, Dropbox…)"}
        </button>
      )}
      {erro && <p className="text-xs text-vermelho">{erro}</p>}
      <p className="text-[11px] text-suave">Quando o Pix cair, o cliente recebe o arquivo direto no WhatsApp, com o nome do produto (ex.: “Receitas de Geladinho.pdf”).</p>
    </div>
  );
}
