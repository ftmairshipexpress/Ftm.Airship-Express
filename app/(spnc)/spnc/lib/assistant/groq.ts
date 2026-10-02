// Shared Groq client (OpenAI-compatible API).
//
// Rate limits (HTTP 429) on Groq are counted PER MODEL. So when one model is out of quota,
// this tries the next model in the list instead of waiting:
//   GROQ_MODEL            first choice            (default openai/gpt-oss-20b, same as before)
//   GROQ_FALLBACK_MODELS  comma-separated backups (default openai/gpt-oss-120b,llama-3.3-70b-versatile,llama-3.1-8b-instant)
// Models that don't exist on your account are skipped automatically.

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

const FALLBACKS = (process.env.GROQ_FALLBACK_MODELS ?? "openai/gpt-oss-120b,llama-3.3-70b-versatile,llama-3.1-8b-instant")
  .split(",")
  .map((m: string) => m.trim())
  .filter(Boolean);

export function hasGroq() {
  return !!process.env.GROQ_API_KEY;
}

export function groqModels(first?: string) {
  return [...new Set([first || GROQ_MODEL, ...FALLBACKS])];
}

// Only reasoning models accept these settings; others reject them.
const isReasoningModel = (m: string) => /gpt-oss|qwen3|deepseek-r1/i.test(m);

// Models that are out of quota, and until when (so we don't keep hitting them)
const coolDown = new Map<string, number>();

/** "7.5s", "1m2.3s", "120ms" or a plain number of seconds → milliseconds */
export function parseWait(v: string | null): number | null {
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v) * 1000;
  let ms = 0;
  let found = false;
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v))) {
    found = true;
    const n = Number(m[1]);
    ms += m[2] === "h" ? n * 3_600_000 : m[2] === "m" ? n * 60_000 : m[2] === "s" ? n * 1000 : n;
  }
  return found ? ms : null;
}

export type GroqResult =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { ok: true; data: any; model: string }
  | { ok: false; status: number; waitMs: number | null; error: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SHORT_WAIT_MS = 15_000;

/**
 * Calls Groq, moving to the next model when one is rate-limited or unavailable.
 * A short rate-limit wait (≤15 s) is waited out once on the same model first.
 */
export async function groqRequest(body: Record<string, unknown>, opts: { model?: string; timeoutMs?: number } = {}): Promise<GroqResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ok: false, status: 401, waitMs: null, error: "Missing GROQ_API_KEY" };

  let last: GroqResult = { ok: false, status: 0, waitMs: null, error: "No Groq model available" };
  let shortest: number | null = null;

  for (const model of groqModels(opts.model)) {
    const until = coolDown.get(model);
    if (until && until > Date.now()) {
      shortest = shortest == null ? until - Date.now() : Math.min(shortest, until - Date.now());
      continue;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
      try {
        const res = await fetch(GROQ_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            ...body,
            model,
            ...(isReasoningModel(model) ? { reasoning_effort: "low", include_reasoning: false } : {}),
          }),
          signal: ctrl.signal,
        });
        if (res.ok) return { ok: true, data: await res.json(), model };

        const text = (await res.text().catch(() => "")).slice(0, 300);
        const waitMs =
          parseWait(res.headers.get("retry-after")) ??
          parseWait(res.headers.get("x-ratelimit-reset-tokens")) ??
          parseWait(res.headers.get("x-ratelimit-reset-requests"));
        last = { ok: false, status: res.status, waitMs, error: text };

        if (res.status === 429) {
          if (attempt === 0 && waitMs != null && waitMs <= SHORT_WAIT_MS) {
            await sleep(waitMs + 250);
            continue; // same model, once
          }
          const wait = waitMs ?? 60_000;
          coolDown.set(model, Date.now() + wait);
          shortest = shortest == null ? wait : Math.min(shortest, wait);
          console.warn(`Groq: ${model} is rate-limited for ${Math.round(wait / 1000)}s, trying the next model`);
          break; // next model
        }
        if (res.status === 404 || res.status === 400 || res.status === 403) {
          // model not available on this account (or doesn't support a setting) → skip it for an hour
          if (res.status !== 400) coolDown.set(model, Date.now() + 3_600_000);
          console.warn(`Groq: ${model} returned ${res.status}, trying the next model. ${text}`);
          break;
        }
        return last; // auth or server error: no point trying other models
      } catch (err) {
        last = { ok: false, status: 0, waitMs: null, error: err instanceof Error ? err.message : "Request failed" };
        break;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  // Every model is rate-limited: report the soonest one frees up
  if (shortest != null) return { ok: false, status: 429, waitMs: shortest, error: "All Groq models are rate-limited" };
  return last;
}

/** Same as groqRequest but throws on failure (used by the chat agent). */
export async function groqChat(body: Record<string, unknown>, timeoutMs = 45_000) {
  const { model, ...rest } = body as { model?: string };
  const r = await groqRequest(rest, { model, timeoutMs });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${r.error}`);
  return r.data;
}