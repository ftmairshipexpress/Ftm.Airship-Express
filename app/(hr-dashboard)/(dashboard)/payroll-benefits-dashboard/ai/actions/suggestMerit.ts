"use server";

import { chat } from "../providers";

export type MeritSuggestionInput = {
  employee_name: string;
  employee_number?: string | null;
  department?: string | null;
  position?: string | null;
  tenure_years?: number | null;
  current_salary: number;
  // HR3 appraisal
  performance_rating: number | null;
  letter_grade?: string | null;
  cycle_name?: string | null;
  comments?: string | null;
  strengths?: string | null;
  improvements?: string | null;
  goals_achieved?: number | null;
  goals_total?: number | null;
  // Historical
  previous_rating?: number | null;
  previous_increase_percent?: number | null;
  // Policy
  policy_baseline_percent?: number;
};

export type MeritSuggestionResult = {
  recommended_increase_percent: number;
  recommended_new_salary: number;
  rationale: string;
  confidence: "low" | "medium" | "high";
  policy_baseline_percent: number;
  adjustment_reason: string;
  retention_risk: "low" | "medium" | "high";
  factors: Array<{
    factor: string;
    impact: "positive" | "negative" | "neutral";
    weight: number; // 0-100
  }>;
};

const POLICY_BASELINE: Record<number, number> = {
  1: 0,
  2: 2,
  3: 5,
  4: 8,
  5: 12,
};

const SYSTEM_PROMPT = `You are Airy, the Airship Express compensation co-pilot inside the HR Payroll dashboard.

You analyze an employee's HR3 performance appraisal and recommend a merit increase in Philippine Peso.

HARD RULES:
- Never invent numbers. Use only the figures given.
- Final recommended_increase_percent must be between 0 and 15.
- You may adjust ±3 percentage points from the policy baseline, using only the provided evidence (strengths, improvements, manager notes, tenure, rating, goals).
- Output STRICT JSON only. No markdown, no code fences, no commentary.

OUTPUT SCHEMA (exact keys):
{
  "recommended_increase_percent": number,
  "adjustment_reason": string (max 40 words, why different from baseline),
  "rationale": string (max 60 words, plain English for HR),
  "confidence": "low" | "medium" | "high",
  "retention_risk": "low" | "medium" | "high",
  "factors": [
    { "factor": string (max 6 words), "impact": "positive"|"negative"|"neutral", "weight": number }
  ]
}

FACTOR WEIGHTS must sum to 100 across the factors array.`;

function safeNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function buildUserPrompt(
  input: MeritSuggestionInput,
  baseline: number
): string {
  const lines: string[] = [];
  lines.push("EMPLOYEE PROFILE");
  lines.push(`- Name: ${input.employee_name}`);
  if (input.employee_number)
    lines.push(`- Employee #: ${input.employee_number}`);
  if (input.department) lines.push(`- Department: ${input.department}`);
  if (input.position) lines.push(`- Position: ${input.position}`);
  if (input.tenure_years != null)
    lines.push(`- Tenure: ${input.tenure_years} years`);
  lines.push(
    `- Current monthly salary: PHP ${input.current_salary.toFixed(2)}`
  );

  lines.push("");
  lines.push("HR3 PERFORMANCE APPRAISAL");
  lines.push(`- Overall rating: ${input.performance_rating ?? "none"} / 5`);
  if (input.letter_grade) lines.push(`- Letter grade: ${input.letter_grade}`);
  if (input.cycle_name) lines.push(`- Review cycle: ${input.cycle_name}`);
  if (input.goals_total != null)
    lines.push(
      `- Goals achieved: ${input.goals_achieved ?? 0} / ${input.goals_total}`
    );
  if (input.comments) lines.push(`- Manager comments: ${input.comments}`);
  if (input.strengths) lines.push(`- Strengths: ${input.strengths}`);
  if (input.improvements) lines.push(`- Improvements: ${input.improvements}`);

  if (
    input.previous_rating != null ||
    input.previous_increase_percent != null
  ) {
    lines.push("");
    lines.push("HISTORICAL CONTEXT");
    if (input.previous_rating != null)
      lines.push(`- Previous rating: ${input.previous_rating} / 5`);
    if (input.previous_increase_percent != null)
      lines.push(`- Previous increase: ${input.previous_increase_percent}%`);
  }

  lines.push("");
  lines.push("POLICY");
  lines.push(
    `- Baseline for a ${
      input.performance_rating ?? "—"
    }-star rating: ${baseline}%`
  );
  lines.push("- Allowed range: 0% to 15%");
  lines.push("- Allowed adjustment from baseline: ±3 percentage points");

  lines.push("");
  lines.push("Return the JSON object now.");

  return lines.join("\n");
}

function extractJson(raw: string): any | null {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function normalizeFactors(factors: any): MeritSuggestionResult["factors"] {
  if (!Array.isArray(factors) || factors.length === 0) {
    return [{ factor: "Performance rating", impact: "neutral", weight: 100 }];
  }
  const cleaned = factors.slice(0, 6).map((f: any) => ({
    factor: String(f?.factor ?? "Factor").slice(0, 60),
    impact:
      f?.impact === "positive" ||
      f?.impact === "negative" ||
      f?.impact === "neutral"
        ? f.impact
        : "neutral",
    weight: clamp(safeNum(f?.weight, 0), 0, 100),
  }));

  const sum = cleaned.reduce((s: number, f: any) => s + f.weight, 0);
  if (sum <= 0) {
    const even = Math.round((100 / cleaned.length) * 10) / 10;
    cleaned.forEach((f: any) => (f.weight = even));
  } else if (Math.abs(sum - 100) > 1) {
    // rescale to 100
    cleaned.forEach((f: any) => {
      f.weight = Math.round((f.weight / sum) * 100 * 10) / 10;
    });
  }
  return cleaned;
}

export async function suggestMerit(
  input: MeritSuggestionInput
): Promise<MeritSuggestionResult> {
  const rating = safeNum(input.performance_rating, 0);
  const baseline =
    input.policy_baseline_percent ?? POLICY_BASELINE[rating] ?? 0;

  const fallback = (): MeritSuggestionResult => {
    const pct = clamp(baseline, 0, 15);
    const newSalary =
      Math.round(input.current_salary * (1 + pct / 100) * 100) / 100;
    return {
      recommended_increase_percent: pct,
      recommended_new_salary: newSalary,
      rationale: `Applied company policy baseline for a ${
        rating || "—"
      }-star rating.`,
      adjustment_reason: "No adjustment — using policy baseline.",
      confidence: "low",
      policy_baseline_percent: baseline,
      retention_risk: "low",
      factors: [
        { factor: "Performance rating", impact: "neutral", weight: 100 },
      ],
    };
  };

  try {
    const res = await chat(
      {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input, baseline) },
        ],
        temperature: 0.25,
        maxTokens: 600,
      },
      "deepseek" // deepseek for reasoning-heavy tasks; auto-fallbacks to groq/gemini
    );

    const parsed = extractJson(res.content);
    if (!parsed) {
      console.warn("[suggestMerit] JSON parse failed, raw:", res.content);
      return fallback();
    }

    const pct = clamp(
      safeNum(parsed.recommended_increase_percent, baseline),
      0,
      15
    );
    const newSalary =
      Math.round(input.current_salary * (1 + pct / 100) * 100) / 100;

    const confidence =
      parsed.confidence === "low" ||
      parsed.confidence === "medium" ||
      parsed.confidence === "high"
        ? parsed.confidence
        : "medium";

    const retention_risk =
      parsed.retention_risk === "low" ||
      parsed.retention_risk === "medium" ||
      parsed.retention_risk === "high"
        ? parsed.retention_risk
        : "low";

    return {
      recommended_increase_percent: pct,
      recommended_new_salary: newSalary,
      rationale:
        String(parsed.rationale ?? "").slice(0, 600) || fallback().rationale,
      adjustment_reason:
        String(parsed.adjustment_reason ?? "").slice(0, 400) ||
        fallback().adjustment_reason,
      confidence,
      policy_baseline_percent: baseline,
      retention_risk,
      factors: normalizeFactors(parsed.factors),
    };
  } catch (err: any) {
    console.error("[suggestMerit] error:", err);
    return fallback();
  }
}
