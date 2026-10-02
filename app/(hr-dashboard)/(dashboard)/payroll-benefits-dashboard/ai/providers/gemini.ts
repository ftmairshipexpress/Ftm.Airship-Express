import { AI_CONFIG } from "../config";
import type { LLMRequest, LLMResponse } from "../shared/types";

function validateKey(): string {
  const k = process.env.GEMINI_API_KEY_HR;
  if (!k) {
    throw new Error("GEMINI_API_KEY_HR is missing from the environment.");
  }
  return k;
}

export async function geminiChat(req: LLMRequest): Promise<LLMResponse> {
  const cfg = AI_CONFIG.gemini;
  const apiKey = validateKey();

  const contents = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const systemInstruction = req.messages.find((m) => m.role === "system");

  const res = await fetch(
    `${cfg.baseUrl}/models/${cfg.model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: systemInstruction
          ? { parts: [{ text: systemInstruction.content }] }
          : undefined,
        generationConfig: {
          temperature: req.temperature ?? 0.7,
          maxOutputTokens: req.maxTokens ?? 1024,
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 400 || res.status === 403) {
      throw new Error(
        `Gemini rejected key or model "${cfg.model}". Check aistudio.google.com/apikey.`
      );
    }
    throw new Error(`Gemini error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return { content: text, provider: "gemini", model: cfg.model };
}

export async function geminiVision(opts: {
  prompt: string;
  imageBase64: string;
  mimeType: string;
  maxTokens?: number;
}): Promise<{ content: string; provider: "gemini"; model: string }> {
  const cfg = AI_CONFIG.gemini;
  const apiKey = validateKey();

  const res = await fetch(
    `${cfg.baseUrl}/models/${cfg.model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: opts.prompt },
              {
                inline_data: {
                  mime_type: opts.mimeType,
                  data: opts.imageBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          // Bumped from 0.1 → 0.35. Too low collapses every receipt to the
          // same "safe" verdict and confidence (e.g. 0.95). Too high loses
          // determinism. 0.3–0.4 gives calibrated variance without chaos.
          temperature: 0.35,
          topP: 0.9,
          maxOutputTokens: opts.maxTokens ?? 900,
          responseMimeType: "application/json",
          // Constrain the JSON shape so fields don't drift between calls.
          responseSchema: {
            type: "object",
            properties: {
              receipt_readable: { type: "boolean" },
              readability_issue: { type: "string", nullable: true },
              extracted: {
                type: "object",
                properties: {
                  merchant: { type: "string", nullable: true },
                  date: { type: "string", nullable: true },
                  amount: { type: "number", nullable: true },
                  currency: { type: "string", nullable: true },
                  items: {
                    type: "array",
                    nullable: true,
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        amount: { type: "number" },
                      },
                      required: ["name", "amount"],
                    },
                  },
                  receipt_number: { type: "string", nullable: true },
                  vat_or_tin: { type: "string", nullable: true },
                },
                required: ["merchant", "date", "amount"],
              },
              mismatches: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: { type: "string" },
                    claimed: { type: "string" },
                    found: { type: "string" },
                    severity: {
                      type: "string",
                      enum: ["low", "medium", "high"],
                    },
                  },
                  required: ["field", "claimed", "found", "severity"],
                },
              },
              tamper_signals: {
                type: "array",
                items: { type: "string" },
              },
              confidence: {
                type: "number",
                description:
                  "Between 0 and 1. Must follow the calibration rubric. Do not default to 0.95.",
              },
              verdict: {
                type: "string",
                enum: ["approve", "review", "reject"],
              },
              notes: { type: "string" },
            },
            required: [
              "receipt_readable",
              "extracted",
              "mismatches",
              "tamper_signals",
              "confidence",
              "verdict",
              "notes",
            ],
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini vision error ${res.status}: ${t}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return { content: text, provider: "gemini", model: cfg.model };
}
