// One OpenAI-compatible chat call, which every supported provider accepts.

export const PROVIDERS = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
};

const ALIASES = { claude: "anthropic", grok: "xai", google: "gemini", gpt: "openai", chatgpt: "openai" };

export function resolveBaseUrl(provider, baseUrl) {
  if (baseUrl) return baseUrl.replace(/\/+$/, "");
  const name = (provider || "").toLowerCase();
  const preset = PROVIDERS[ALIASES[name] || name];
  if (!preset) {
    const known = Object.keys(PROVIDERS).join(", ");
    throw new Error(`Unknown provider "${provider}". Use one of: ${known}, or set base-url for a custom OpenAI-compatible endpoint.`);
  }
  return preset;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends the chat request. Retries rate limits and server errors, and switches to
// max_completion_tokens for models that reject max_tokens (OpenAI reasoning models).
// No temperature is sent: several current models reject non-default values.
export async function chat({ baseUrl, apiKey, model, messages, maxTokens, timeoutMs = 300_000 }) {
  let tokenField = "max_tokens";
  let lastError;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const body = { model, messages, [tokenField]: maxTokens };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res, text;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      text = await res.text();
    } catch (err) {
      lastError = new Error(err.name === "AbortError" ? `Model request timed out after ${timeoutMs / 1000}s` : `Model request failed: ${err.message}`);
      await sleep(2000 * attempt);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      const json = JSON.parse(text);
      const content = json.choices?.[0]?.message?.content;
      const out = Array.isArray(content) ? content.map((p) => p.text || "").join("") : content;
      if (!out) throw new Error(`Model returned no content (finish_reason: ${json.choices?.[0]?.finish_reason ?? "unknown"}).`);
      return { content: out, usage: json.usage, finishReason: json.choices?.[0]?.finish_reason };
    }

    lastError = new Error(`Model API ${res.status}: ${text.slice(0, 500)}`);
    if (res.status === 400 && tokenField === "max_tokens" && /max_tokens|max_completion_tokens/i.test(text)) {
      tokenField = "max_completion_tokens";
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * attempt);
      continue;
    }
    throw lastError; // 401, 403, 404, other 400s: retrying will not help
  }
  throw lastError;
}

// Pulls the JSON object out of a reply that may be wrapped in a code fence or prose.
export function extractJson(text) {
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object found in the model reply.");
  return JSON.parse(unfenced.slice(start, end + 1));
}
