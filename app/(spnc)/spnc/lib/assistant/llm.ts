// The assistant's chat brain: an AI model that calls the tools in tools.ts.
// Uses Groq by default (same GROQ_API_KEY as your anomaly routes).
// Optional: set ASSISTANT_AI_PROVIDER=anthropic and ANTHROPIC_API_KEY to use Claude instead.

import { groqChat } from "./groq";
import { TOOLS, runTool, type Block, type ToolResult } from "./tool";

export type ChatTurn = { role: "user" | "assistant"; content: string };

const MAX_TOOL_ROUNDS = 5;

export function aiProvider(): "groq" | "anthropic" | null {
  const pref = (process.env.ASSISTANT_AI_PROVIDER || "").toLowerCase();
  if (pref === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (pref === "groq" && process.env.GROQ_API_KEY) return "groq";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

function systemPrompt() {
  const now = new Date().toLocaleString("en-PH", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: process.env.ASSISTANT_TIMEZONE || "Asia/Manila",
  });
  return `You are Airy AI, the assistant built into the Service Provider & Network Control (SPNC) system of Airship Express, a Philippine logistics company.
You help operations staff with service providers (carriers, freight forwarders, customs brokers), their performance, assigned shipments, rates, SOPs and documents, and with monitoring the network: shipments, delays, routes, alerts, anomalies and exceptions.

Current date/time: ${now} (Philippine time).

Rules:
- Always call a tool to get facts before answering. Never invent providers, shipments, numbers, rates or documents.
- The chat UI already shows tool results as tables and cards under your message. Do NOT repeat those tables. Write a short answer (1–4 sentences, or a few bullets) that highlights what matters: key numbers, the most urgent items, and one recommended next step.
- Use **bold** for trip codes, provider names and key figures. Currency is Philippine peso (₱).
- "Shipments" are the trips in the system (trip codes like TRP-0001). On time = delivered within 15 minutes of the scheduled arrival.
- Alerts have two groups: network alerts (shipments) and data anomalies (providers, rates, SOPs; some found by AI).
- If a feature's data isn't set up, say so plainly.
- If a question is outside logistics operations, briefly say you can only help with Airship Express logistics data.`;
}

type Collected = { blocks: Block[]; suggestions: string[]; seen: Set<string> };

async function execTool(name: string, input: Record<string, unknown>, col: Collected): Promise<string> {
  let out: ToolResult;
  try {
    out = await runTool(name, input);
  } catch (err) {
    out = { data: { error: err instanceof Error ? err.message : "Tool failed" }, blocks: [] };
  }
  const key = `${name}:${JSON.stringify(input)}`;
  if (!col.seen.has(key)) {
    col.seen.add(key);
    col.blocks.push(...out.blocks);
    col.suggestions.push(...(out.suggestions ?? []));
  }
  return JSON.stringify(out.data).slice(0, 24_000);
}

/* ------------------------------------------------------------------ */
/* Groq (OpenAI-compatible tool calling)                               */
/* ------------------------------------------------------------------ */

type OAIMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

async function groqAgent(message: string, history: ChatTurn[], col: Collected): Promise<string> {
  const messages: OAIMessage[] = [
    { role: "system", content: systemPrompt() },
    ...history.slice(-10).map((h) => ({ role: h.role, content: h.content || "…" }) as OAIMessage),
    { role: "user", content: message },
  ];
  const tools = TOOLS.map(({ name, description, input_schema }) => ({
    type: "function" as const,
    function: { name, description, parameters: input_schema },
  }));

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const last = round === MAX_TOOL_ROUNDS;
    const data = await groqChat({
      model: process.env.ASSISTANT_GROQ_MODEL || process.env.GROQ_MODEL || "openai/gpt-oss-20b",
      max_completion_tokens: 2000,
      messages,
      ...(last ? {} : { tools, tool_choice: "auto" }),
    });
    const msg = data.choices?.[0]?.message ?? {};
    const calls: { id: string; function: { name: string; arguments: string } }[] = msg.tool_calls ?? [];

    if (!calls.length || last) return String(msg.content ?? "").trim();

    messages.push({
      role: "assistant",
      content: msg.content ?? null,
      tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.function.name, arguments: c.function.arguments || "{}" } })),
    });
    for (const c of calls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(c.function.arguments || "{}");
      } catch {
        /* bad JSON from model: run with no args */
      }
      messages.push({ role: "tool", tool_call_id: c.id, content: await execTool(c.function.name, input, col) });
    }
  }
  return "";
}

/* ------------------------------------------------------------------ */
/* Anthropic (optional)                                                */
/* ------------------------------------------------------------------ */

type ABlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

async function anthropicAgent(message: string, history: ChatTurn[], col: Collected): Promise<string> {
  const messages: { role: "user" | "assistant"; content: string | ABlock[] }[] = [
    ...history.slice(-10).map((h) => ({ role: h.role, content: h.content || "…" })),
    { role: "user", content: message },
  ];
  while (messages.length && messages[0].role !== "user") messages.shift();

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY as string,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ASSISTANT_MODEL || "claude-sonnet-5-5",
        max_tokens: 1024,
        system: systemPrompt(),
        tools: TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
        messages,
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    const resp = (await res.json()) as { content: ABlock[]; stop_reason: string };
    const uses = resp.content.filter((c): c is Extract<ABlock, { type: "tool_use" }> => c.type === "tool_use");

    if (resp.stop_reason !== "tool_use" || !uses.length || round === MAX_TOOL_ROUNDS) {
      return resp.content
        .filter((c): c is Extract<ABlock, { type: "text" }> => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
    }
    messages.push({ role: "assistant", content: resp.content });
    const results: ABlock[] = [];
    for (const u of uses) results.push({ type: "tool_result", tool_use_id: u.id, content: await execTool(u.name, u.input, col) });
    messages.push({ role: "user", content: results });
  }
  return "";
}

/* ------------------------------------------------------------------ */

export async function aiAnswer(message: string, history: ChatTurn[]) {
  const provider = aiProvider();
  if (!provider) throw new Error("No AI key configured");
  const col: Collected = { blocks: [], suggestions: [], seen: new Set() };
  const text = provider === "groq" ? await groqAgent(message, history, col) : await anthropicAgent(message, history, col);
  return {
    reply: text || (col.blocks.length ? "Here's what I found." : "Sorry, I couldn't answer that."),
    blocks: col.blocks,
    suggestions: [...new Set(col.suggestions)].slice(0, 3),
    provider,
  };
}