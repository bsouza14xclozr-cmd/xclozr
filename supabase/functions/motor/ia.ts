// Agente de IA: OpenAI, Claude (Anthropic) ou Gemini — a chave fica só no servidor (tabela ia_config).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { primeiroNome, type Config, type Contato } from "./motor.ts";

export type Provedor = "openai" | "anthropic" | "gemini";
export type ConfigIA = { provedor: Provedor; modelo: string; chave: string };
type Msg = { papel: "cliente" | "vendedor"; texto: string };
export type RespostaIA = { resposta: string; concluido: boolean } | { erro: string };

export const MODELO_PADRAO: Record<Provedor, string> = {
  openai: "gpt-5.4-mini",
  anthropic: "claude-haiku-5-5",
  gemini: "gemini-flash-latest",
};

const LIMITE_TOKENS = 1500;

function extrairJson(t: string): { resposta?: unknown; concluido?: unknown } | null {
  const ini = t.indexOf("{");
  const fim = t.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try {
    return JSON.parse(t.slice(ini, fim + 1));
  } catch {
    return null;
  }
}

/**
 * Instruções divididas em duas partes para o cache de prompt:
 * - fixo: igual para todos os clientes do mesmo funil (regras, produto) → vai primeiro e fica em cache
 * - variavel: muda por cliente (nome, campos) → vai depois, fora do cache
 */
export type Sistema = { fixo: string; variavel?: string };
type Uso = { texto: string; entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number };

async function chamar(cfg: ConfigIA, sis: Sistema | string, msgs: Msg[]): Promise<Uso> {
  const { fixo, variavel = "" } = typeof sis === "string" ? { fixo: sis } : sis;
  const sistema = variavel ? `${fixo}\n\n${variavel}` : fixo;
  const sinal = AbortSignal.timeout(30_000);
  if (cfg.provedor === "openai") {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: sinal,
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.chave}` },
      body: JSON.stringify({
        model: cfg.modelo,
        max_completion_tokens: LIMITE_TOKENS,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sistema }, ...msgs.map((m) => ({ role: m.papel === "cliente" ? "user" : "assistant", content: m.texto }))],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message ?? `OpenAI ${r.status}`);
    // a OpenAI faz cache sozinha do começo repetido do prompt (por isso o fixo vem primeiro)
    const cache = j.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return { texto: String(j.choices?.[0]?.message?.content ?? ""), entrada: (j.usage?.prompt_tokens ?? 0) - cache, saida: j.usage?.completion_tokens ?? 0, cacheLeitura: cache, cacheEscrita: 0 };
  }

  if (cfg.provedor === "anthropic") {
    // a API exige começar com o usuário e alternar papéis
    const juntas: { role: "user" | "assistant"; content: string }[] = [];
    for (const m of msgs) {
      const role = m.papel === "cliente" ? "user" : "assistant";
      const ult = juntas[juntas.length - 1];
      if (ult && ult.role === role) ult.content += `\n${m.texto}`;
      else juntas.push({ role, content: m.texto });
    }
    if (!juntas.length || juntas[0].role !== "user") juntas.unshift({ role: "user", content: "(o cliente iniciou a conversa)" });
    if (juntas[juntas.length - 1].role !== "user") juntas.push({ role: "user", content: "(o cliente ainda não respondeu; continue a conversa)" });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: sinal,
      headers: { "content-type": "application/json", "x-api-key": cfg.chave, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: cfg.modelo,
        max_tokens: LIMITE_TOKENS,
        // cache de prompt: as instruções fixas ficam 1 h em cache (servem para todos os clientes)…
        system: [
          { type: "text", text: fixo, cache_control: { type: "ephemeral", ttl: "1h" } },
          ...(variavel ? [{ type: "text", text: variavel }] : []),
        ],
        // …e a conversa de cada cliente fica 5 min (a próxima resposta dele reaproveita o histórico)
        cache_control: { type: "ephemeral" },
        messages: juntas,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message ?? `Claude ${r.status}`);
    const texto = (j.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    return {
      texto,
      entrada: j.usage?.input_tokens ?? 0,
      saida: j.usage?.output_tokens ?? 0,
      cacheLeitura: j.usage?.cache_read_input_tokens ?? 0,
      cacheEscrita: j.usage?.cache_creation_input_tokens ?? 0,
    };
  }

  // gemini
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const m of msgs) {
    const role = m.papel === "cliente" ? "user" : "model";
    const ult = contents[contents.length - 1];
    if (ult && ult.role === role) ult.parts[0].text += `\n${m.texto}`;
    else contents.push({ role, parts: [{ text: m.texto }] });
  }
  if (!contents.length || contents[contents.length - 1].role !== "user") contents.push({ role: "user", parts: [{ text: "(continue a conversa)" }] });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.modelo)}:generateContent`, {
    method: "POST",
    signal: sinal,
    headers: { "content-type": "application/json", "x-goog-api-key": cfg.chave },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] },
      contents,
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: LIMITE_TOKENS * 2 },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? `Gemini ${r.status}`);
  const texto = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  // o Gemini também faz cache sozinho do começo repetido do prompt
  const cache = j.usageMetadata?.cachedContentTokenCount ?? 0;
  return { texto, entrada: (j.usageMetadata?.promptTokenCount ?? 0) - cache, saida: j.usageMetadata?.candidatesTokenCount ?? 0, cacheLeitura: cache, cacheEscrita: 0 };
}

function montarSistema(c: Contato, b: Config): Sistema {
  const nome = primeiroNome(c.nome) || primeiroNome(c.campos?.nome ?? null);
  const campos = Object.entries(c.campos ?? {})
    .filter(([k, v]) => v && !k.startsWith("__"))
    .map(([k, v]) => `${k}: ${String(v).slice(0, 120)}`)
    .join("; ");
  // tudo que é igual para todos os clientes vem primeiro (fica em cache); o que é do cliente vai no fim
  const fixo = [
    "Você é um vendedor atendendo um cliente pelo WhatsApp, em português do Brasil.",
    b.instrucoes ? `\nQUEM VOCÊ É E COMO AGIR:\n${b.instrucoes}` : "",
    b.conhecimento ? `\nINFORMAÇÕES DO PRODUTO (use só isto; nunca invente preço, prazo ou garantia):\n${b.conhecimento}` : "",
    b.objetivo ? `\nOBJETIVO: ${b.objetivo}` : "\nOBJETIVO: tirar as dúvidas e levar o cliente a decidir comprar.",
    "\nREGRAS:",
    "- Mensagens curtas e naturais, como no WhatsApp (1 a 3 frases). Sem títulos, sem markdown, no máximo 1 emoji.",
    "- Faça uma pergunta por vez. Não repita o que já foi dito.",
    "- Não envie links nem chaves Pix: o Pix é gerado pelo sistema depois que o objetivo for concluído.",
    "- Se pedirem para falar com humano, responda com educação e marque concluido como false.",
    '\nResponda SOMENTE com um JSON: {"resposta": "texto para o cliente", "concluido": true ou false}.',
    "concluido = true apenas quando o OBJETIVO foi atingido (ex.: o cliente disse claramente que quer comprar).",
  ]
    .filter(Boolean)
    .join("\n");
  const variavel = `CLIENTE DESTA CONVERSA: ${nome ? `primeiro nome ${nome}` : "nome desconhecido (não invente um nome)"}${campos ? `; ${campos}` : ""}.`;
  return { fixo, variavel };
}

export async function configIA(db: SupabaseClient, donoId: string): Promise<ConfigIA | null> {
  const { data } = await db.from("ia_config").select("provedor, modelo, chave").eq("dono_id", donoId).maybeSingle();
  return data ? (data as ConfigIA) : null;
}

export async function responderIA(db: SupabaseClient, donoId: string, c: Contato, bloco: Config): Promise<RespostaIA> {
  const cfg = await configIA(db, donoId);
  if (!cfg) return { erro: "O agente de IA não está configurado (menu Agente de IA)." };

  const { data: hist } = await db
    .from("mensagens")
    .select("autor, conteudo, tipo")
    .eq("contato_id", c.id)
    .order("criado_em", { ascending: false })
    .limit(24);
  const msgs: Msg[] = (hist ?? [])
    .reverse()
    .map((m: { autor: string; conteudo: string | null; tipo: string }) => ({
      papel: (m.autor === "cliente" ? "cliente" : "vendedor") as Msg["papel"],
      texto: (m.conteudo || (m.tipo !== "texto" ? `[${m.tipo}]` : "")).slice(0, 1500),
    }))
    .filter((m) => m.texto);

  try {
    const r = await chamar(cfg, montarSistema(c, bloco), msgs);
    await db.from("ia_uso").insert({
      dono_id: donoId,
      contato_id: c.id,
      provedor: cfg.provedor,
      modelo: cfg.modelo,
      tokens_entrada: r.entrada,
      tokens_saida: r.saida,
      tokens_cache_leitura: r.cacheLeitura,
      tokens_cache_escrita: r.cacheEscrita,
      simulacao: c.simulacao,
    });
    const j = extrairJson(r.texto);
    const resposta = String(j?.resposta ?? (j ? "" : r.texto)).trim();
    if (!resposta) return { erro: "A IA respondeu vazio." };
    return { resposta: resposta.slice(0, 3000), concluido: j?.concluido === true || j?.concluido === "true" };
  } catch (e) {
    return { erro: `Falha na IA (${cfg.provedor}): ${(e as Error).message}`.slice(0, 300) };
  }
}

/** Testa uma chave antes de salvar. */
export async function testarIA(cfg: ConfigIA) {
  const r = await chamar(cfg, 'Responda só com o JSON {"resposta": "ok", "concluido": false}.', [{ papel: "cliente", texto: "teste" }]);
  return r.texto.length > 0;
}
