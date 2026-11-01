// IA do agente de tráfego (mesmas chaves do Agente de IA: OpenAI, Claude ou Gemini)
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ConfigIA = { provedor: "openai" | "anthropic" | "gemini"; modelo: string; chave: string };

export async function configIA(db: SupabaseClient, donoId: string): Promise<ConfigIA | null> {
  const { data } = await db.from("ia_config").select("provedor, modelo, chave").eq("dono_id", donoId).maybeSingle();
  return (data as ConfigIA) ?? null;
}

/** Faz uma pergunta e devolve o texto (pedindo JSON). */
export async function perguntarIA(cfg: ConfigIA, sistema: string, usuario: string, maxTokens = 3000) {
  const sinal = AbortSignal.timeout(90_000);
  if (cfg.provedor === "openai") {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: sinal,
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.chave}` },
      body: JSON.stringify({
        model: cfg.modelo,
        max_completion_tokens: maxTokens + 4000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: usuario },
        ],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message ?? `OpenAI ${r.status}`);
    return { texto: String(j.choices?.[0]?.message?.content ?? ""), entrada: j.usage?.prompt_tokens ?? 0, saida: j.usage?.completion_tokens ?? 0 };
  }
  if (cfg.provedor === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: sinal,
      headers: { "content-type": "application/json", "x-api-key": cfg.chave, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.modelo, max_tokens: maxTokens, system: sistema, messages: [{ role: "user", content: usuario }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message ?? `Claude ${r.status}`);
    const texto = (j.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    return { texto, entrada: j.usage?.input_tokens ?? 0, saida: j.usage?.output_tokens ?? 0 };
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.modelo)}:generateContent`, {
    method: "POST",
    signal: sinal,
    headers: { "content-type": "application/json", "x-goog-api-key": cfg.chave },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] },
      contents: [{ role: "user", parts: [{ text: usuario }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: maxTokens * 3 },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? `Gemini ${r.status}`);
  const texto = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  return { texto, entrada: j.usageMetadata?.promptTokenCount ?? 0, saida: j.usageMetadata?.candidatesTokenCount ?? 0 };
}

export function extrairJson<T>(t: string): T | null {
  const ini = t.indexOf("{");
  const fim = t.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try {
    return JSON.parse(t.slice(ini, fim + 1)) as T;
  } catch {
    return null;
  }
}
