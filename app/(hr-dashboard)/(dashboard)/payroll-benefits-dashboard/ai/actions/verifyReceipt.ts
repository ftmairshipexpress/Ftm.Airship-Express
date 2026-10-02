"use server";

import { supabaseAdmin } from "@/app/(hr-dashboard)/supabase/admin-client";
import { visionChat } from "../providers";
import { loadKnowledgeServer } from "../knowledge/serverLoader";

export type ReceiptVerdict = {
  ok: true;
  receipt_readable: boolean;
  readability_issue: string | null;
  extracted: {
    merchant: string | null;
    date: string | null;
    amount: number | null;
    currency: string | null;
    items: Array<{ name: string; amount: number }> | null;
    receipt_number: string | null;
    vat_or_tin: string | null;
  };
  mismatches: Array<{
    field: string;
    claimed: string;
    found: string;
    severity: "low" | "medium" | "high";
  }>;
  tamper_signals: string[];
  confidence: number;
  verdict: "approve" | "review" | "reject";
  notes: string;
  provider: string;
  model: string;
};

export type ReceiptVerdictError = { ok: false; error: string };

function fieldMatchScore(opts: {
  claimedAmount: number;
  claimedDescription: string;
  claimedClaimType: string;
  extractedAmount: number | null;
  extractedMerchant: string | null;
}): number {
  const {
    claimedAmount,
    claimedDescription,
    claimedClaimType,
    extractedAmount,
    extractedMerchant,
  } = opts;

  let amountScore = 0;
  const claimed = Number(claimedAmount) || 0;
  if (extractedAmount != null && claimed > 0) {
    const absDiff = Math.abs(extractedAmount - claimed);
    const pctDiff = absDiff / claimed;
    if (absDiff <= 1) amountScore = 1.0;
    else if (pctDiff <= 0.01) amountScore = 0.95;
    else if (pctDiff <= 0.05) amountScore = 0.7;
    else if (pctDiff <= 0.2) amountScore = 0.35;
    else amountScore = 0;
  }

  const norm = (s: string) =>
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .trim();
  const tokens = (s: string) =>
    new Set(
      norm(s)
        .split(/\s+/)
        .filter((w) => w.length >= 3)
    );

  const claimedTokens = new Set([
    ...tokens(claimedDescription),
    ...tokens(claimedClaimType),
  ]);
  const foundTokens = tokens(extractedMerchant || "");

  let overlapBonus = 0;
  if (claimedTokens.size > 0 && foundTokens.size > 0) {
    let hits = 0;
    foundTokens.forEach((t) => {
      if (claimedTokens.has(t)) hits++;
    });
    overlapBonus = Math.min(
      0.05,
      (hits / Math.max(1, foundTokens.size)) * 0.05
    );
  }

  return Math.max(0, Math.min(1, amountScore + overlapBonus));
}

function deriveConfidence(
  parsed: any,
  fieldScore: number,
  claimedAmount: number,
  claimedDescription: string,
  claimedClaimType: string
): number {
  const raw =
    typeof parsed?.confidence === "number" && Number.isFinite(parsed.confidence)
      ? parsed.confidence
      : 0;

  const normalized = raw > 1 ? raw / 100 : raw;
  const clamped = Math.max(0, Math.min(1, normalized));

  const hasMismatch =
    Array.isArray(parsed?.mismatches) && parsed.mismatches.length > 0;
  const hasTamper =
    Array.isArray(parsed?.tamper_signals) && parsed.tamper_signals.length > 0;
  const unreadable = parsed?.receipt_readable === false;
  const verdict = parsed?.verdict;

  const extractedAmount =
    typeof parsed?.extracted?.amount === "number"
      ? parsed.extracted.amount
      : null;
  const extractedMerchant =
    typeof parsed?.extracted?.merchant === "string"
      ? parsed.extracted.merchant
      : null;

  const serverFieldScore = fieldMatchScore({
    claimedAmount,
    claimedDescription,
    claimedClaimType,
    extractedAmount,
    extractedMerchant,
  });

  const effectiveFieldScore = Math.min(fieldScore || 1, serverFieldScore);

  if (unreadable) return Math.min(clamped, 0.19);
  if (hasTamper) return Math.min(clamped, 0.54);
  if (verdict === "reject") return Math.min(clamped, 0.4);
  if (verdict === "review") return Math.min(clamped, 0.79);
  if (hasMismatch && clamped >= 0.9) {
    console.warn(
      "[verifyReceipt] confidence guard tripped",
      JSON.stringify({
        rawConfidence: clamped,
        hasMismatch,
        hasTamper,
        unreadable,
        verdict,
      })
    );
    return Math.min(clamped, 0.79);
  }

  return Math.min(clamped, effectiveFieldScore);
}

export async function verifyReceipt(opts: {
  employeeId: string;
  imageBase64: string;
  mimeType: string;
  claimedAmount: number;
  claimedDescription: string;
  claimedClaimType: string;
  verifiedByAdminId: string;
  claimId?: string | null;
  receiptUrl?: string | null;
  fieldScore?: number;
}): Promise<ReceiptVerdict | ReceiptVerdictError> {
  try {
    const systemPrompt = loadKnowledgeServer("receipt-verifier");
    if (!systemPrompt) {
      return { ok: false, error: "Receipt verifier knowledge missing." };
    }

    const today = new Date().toISOString().slice(0, 10);

    const userPrompt =
      systemPrompt +
      `\n\n---\nCLAIMED DATA\n` +
      `amount: ${opts.claimedAmount}\n` +
      `description: ${opts.claimedDescription || "(empty)"}\n` +
      `claim_type: ${opts.claimedClaimType}\n` +
      `today: ${today}\n`;

    const res = await visionChat({
      prompt: userPrompt,
      imageBase64: opts.imageBase64,
      mimeType: opts.mimeType,
      maxTokens: 900,
    });

    let parsed: any;
    try {
      parsed = JSON.parse(res.content);
    } catch {
      return { ok: false, error: "AI returned non-JSON response." };
    }

    const verdict: ReceiptVerdict = {
      ok: true,
      receipt_readable: !!parsed.receipt_readable,
      readability_issue: parsed.readability_issue ?? null,
      extracted: {
        merchant: parsed.extracted?.merchant ?? null,
        date: parsed.extracted?.date ?? null,
        amount: parsed.extracted?.amount ?? null,
        currency: parsed.extracted?.currency ?? null,
        items: Array.isArray(parsed.extracted?.items)
          ? parsed.extracted.items
          : null,
        receipt_number: parsed.extracted?.receipt_number ?? null,
        vat_or_tin: parsed.extracted?.vat_or_tin ?? null,
      },
      mismatches: Array.isArray(parsed.mismatches) ? parsed.mismatches : [],
      tamper_signals: Array.isArray(parsed.tamper_signals)
        ? parsed.tamper_signals
        : [],
      confidence: deriveConfidence(
        parsed,
        opts.fieldScore ?? 1,
        opts.claimedAmount,
        opts.claimedDescription,
        opts.claimedClaimType
      ),
      verdict:
        parsed.verdict === "approve" ||
        parsed.verdict === "review" ||
        parsed.verdict === "reject"
          ? parsed.verdict
          : "review",
      notes: parsed.notes ?? "",
      provider: res.provider,
      model: res.model,
    };

    await supabaseAdmin.from("hr4_claim_receipt_verifications").insert({
      claim_id: opts.claimId ?? null,
      employee_id: opts.employeeId,
      receipt_url: opts.receiptUrl || "pending-upload",
      claimed_amount: opts.claimedAmount,
      claimed_description: opts.claimedDescription || null,
      claimed_claim_type: opts.claimedClaimType,
      extracted_amount: verdict.extracted.amount,
      extracted_merchant: verdict.extracted.merchant,
      extracted_date: verdict.extracted.date,
      extracted_items: verdict.extracted.items,
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      mismatches: verdict.mismatches,
      notes: verdict.notes,
      provider: verdict.provider,
      model: verdict.model,
      raw_response: {
        ...parsed,
        confidence: verdict.confidence,
      },
      verified_by: opts.verifiedByAdminId || null,
    });

    return verdict;
  } catch (err: any) {
    console.error("[verifyReceipt] error:", err);
    return { ok: false, error: err?.message ?? "Receipt verification failed." };
  }
}
