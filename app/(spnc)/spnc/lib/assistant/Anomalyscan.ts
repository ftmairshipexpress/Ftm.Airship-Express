// One AI anomaly scan, shared by the dashboard (/api/anomaly-detect) and the assistant.
// Keeps Groq usage low so you stay under its rate limits (HTTP 429):
//   - Results are cached for 10 minutes per data snapshot, so the dashboard, the assistant and
//     every open browser tab reuse one scan instead of each calling Groq.
//   - Identical scans running at the same time share one request.
//   - On 429 it switches to another Groq model (each has its own quota, see groq.ts). Only if every
//     model is rate-limited does it return the last good result, marked stale, plus when to retry.

import { createHash } from "crypto";
import { ANOMALY_SYSTEM_PROMPT, parseAnomalyReply, type RawAnomaly } from "./AnomalyPrompt";
import { groqRequest } from "./groq";

const CACHE_MS = Number(process.env.ASSISTANT_ANOMALY_CACHE_MINUTES || 10) * 60_000;
const MAX_INPUT_CHARS = 60_000;

export type ScanInput = { today: string; now?: string; providers: unknown[]; rates: unknown[]; sops: unknown[]; trips?: unknown[] };
export type ScanResult = {
  anomalies: RawAnomaly[];
  cached?: boolean;
  stale?: boolean; // showing the previous result because a fresh scan failed
  error?: string;
  retryAfter?: number; // seconds until it's worth trying again
};

const fmtWait = (sec: number) => (sec >= 90 ? `${Math.round(sec / 60)} min` : `${sec}s`);

type Entry = { at: number; anomalies: RawAnomaly[] };
const cache = new Map<string, Entry>();
let lastGood: Entry | null = null;
const inFlight = new Map<string, Promise<ScanResult>>();

// Same data → same key, whatever order or number formatting the caller used.
function canonical(input: ScanInput) {
  const clean = (rows: unknown[]) =>
    (Array.isArray(rows) ? rows : [])
      .map((r) => {
        const o: Record<string, string> = {};
        for (const [k, v] of Object.entries((r ?? {}) as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
          if (v === null || v === undefined || v === "") continue;
          o[k] = String(v);
        }
        return o;
      })
      .sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));
  return JSON.stringify({
    today: input.today,
    now: input.now,
    providers: clean(input.providers),
    rates: clean(input.rates),
    sops: clean(input.sops),
    trips: clean(input.trips ?? []),
  });
}

async function callGroq(payload: string): Promise<{ ok: true; anomalies: RawAnomaly[] } | { ok: false; status: number; waitMs: number | null; error: string }> {
  // groqRequest moves to another Groq model when one is rate-limited (each model has its own quota).
  const r = await groqRequest({
    // Groq counts this against your tokens-per-minute limit, so keep it no bigger than needed.
    max_completion_tokens: Number(process.env.ASSISTANT_ANOMALY_MAX_TOKENS || 3500),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: ANOMALY_SYSTEM_PROMPT },
      { role: "user", content: payload },
    ],
  });
  if (!r.ok) return r;
  return { ok: true, anomalies: parseAnomalyReply(r.data.choices?.[0]?.message?.content ?? "") };
}

/**
 * cachedOnly: never call Groq; return the cached (or last good) result, or nothing.
 * Used where waiting on the AI would slow things down, e.g. the assistant's Network Overview.
 */
export async function scanAnomalies(input: ScanInput, opts: { cachedOnly?: boolean } = {}): Promise<ScanResult> {
  if (!process.env.GROQ_API_KEY) return { anomalies: [], error: "Missing GROQ_API_KEY" };

  const payload = canonical(input);
  if (payload.length > MAX_INPUT_CHARS) return { anomalies: [], error: "Too much data to scan in one request" };

  const key = createHash("sha1").update(payload).digest("hex");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { anomalies: hit.anomalies, cached: true };
  if (opts.cachedOnly) return lastGood ? { anomalies: lastGood.anomalies, cached: true, stale: true } : { anomalies: [] };

  const running = inFlight.get(key);
  if (running) return running;

  const job = (async (): Promise<ScanResult> => {
    try {
      const r = await callGroq(payload);
      if (r.ok) {
        const entry = { at: Date.now(), anomalies: r.anomalies };
        cache.set(key, entry);
        lastGood = entry;
        for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k); // keep the cache small
        return { anomalies: r.anomalies };
      }
      console.error("Groq anomaly scan failed", r.status, r.error);
      const retryAfter = r.status === 429 ? Math.max(30, Math.ceil((r.waitMs ?? 60_000) / 1000)) : undefined;
      const error =
        r.status === 429
          ? `The AI is busy (Groq rate limit on all models). Trying again in ${fmtWait(retryAfter ?? 60)}.`
          : `Groq returned ${r.status}`;
      // Better to show the last result than nothing
      if (lastGood) return { anomalies: lastGood.anomalies, stale: true, error, retryAfter };
      return { anomalies: [], error, retryAfter };
    } catch (err) {
      console.error("Groq anomaly scan error", err);
      if (lastGood) return { anomalies: lastGood.anomalies, stale: true, error: "Couldn't reach the AI" };
      return { anomalies: [], error: "Couldn't reach the AI" };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, job);
  return job;
}