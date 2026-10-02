import type {
  AiryVerifyState,
  AiryVerdict,
} from "@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/ai/ui/AiryVerifiedBadge";

/**
 * Deterministic field-match score (0..1). Same logic as the server action,
 * kept here so rows hydrate with a field-aware confidence even before a fresh
 * scan.
 */
export function fieldMatchScoreFromClaim(
  claim: any,
  verification?: any | null
): number {
  const claimed = Number(claim?.amount) || 0;
  const desc = String(claim?.description || "");
  const type = String(claim?.claim_type_name || "");

  const extractedAmount =
    verification?.extracted_amount != null
      ? Number(verification.extracted_amount)
      : null;
  const extractedMerchant =
    verification?.extracted_merchant != null
      ? String(verification.extracted_merchant)
      : null;

  let amountScore = 0;
  if (extractedAmount != null && claimed > 0) {
    const pctDiff = Math.abs(extractedAmount - claimed) / claimed;
    if (pctDiff === 0) amountScore = 1.0;
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

  const claimedTokens = new Set([...tokens(desc), ...tokens(type)]);
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

export function blendConfidence(
  aiConfidence: number,
  fieldScore: number,
  verdict: "approve" | "review" | "reject"
): number {
  const a = Math.max(0, Math.min(1, aiConfidence || 0));
  const f = Math.max(0, Math.min(1, fieldScore || 0));

  if (verdict === "reject") return Math.min(a, 0.4);
  if (verdict === "review") return Math.min(a, 0.79);
  return Math.min(a, f);
}

export function claimToAiryState(
  claim: any,
  verification?: any | null
): AiryVerifyState {
  if (verification && typeof verification === "object") {
    const v = verification.verdict;
    if (v === "approve" || v === "review" || v === "reject") {
      const raw = verification.raw_response || {};
      const storedConfidence = Number(verification.confidence) || 0;

      // Re-blend with current claim inputs in case the claimed amount or
      // description changed after the scan — the badge should reflect today's
      // data, not yesterday's.
      const fieldScore = fieldMatchScoreFromClaim(claim, verification);
      const finalConfidence = blendConfidence(
        storedConfidence,
        fieldScore,
        v as "approve" | "review" | "reject"
      );

      return {
        status: "done",
        verdict: v as AiryVerdict,
        confidence: finalConfidence,
        notes: String(verification.notes || ""),
        mismatches: Array.isArray(verification.mismatches)
          ? verification.mismatches
          : Array.isArray(raw?.mismatches)
          ? raw.mismatches
          : [],
        tamperSignals: Array.isArray(raw?.tamper_signals)
          ? raw.tamper_signals
          : [],
        provider: String(verification.provider || "airy"),
        model: String(verification.model || ""),
        extracted: {
          merchant: verification.extracted_merchant ?? null,
          date: verification.extracted_date ?? null,
          amount:
            verification.extracted_amount != null
              ? Number(verification.extracted_amount)
              : null,
          currency: raw?.extracted?.currency ?? "PHP",
          receipt_number: raw?.extracted?.receipt_number ?? null,
          vat_or_tin: raw?.extracted?.vat_or_tin ?? null,
          items: Array.isArray(verification.extracted_items)
            ? verification.extracted_items
            : null,
        },
        receiptReadable: raw?.receipt_readable !== false,
        readabilityIssue: raw?.readability_issue ?? null,
        override:
          claim?.ai_override === true || raw?.override === true || false,
        overrideBy: raw?.override_by ?? null,
        overrideReason: raw?.override_reason ?? null,
        overriddenAt: raw?.overridden_at ?? null,
      };
    }
  }

  const v = claim?.ai_verdict;
  if (v === "approve" || v === "review" || v === "reject") {
    const storedConfidence = Number(claim?.ai_confidence) || 0;
    return {
      status: "done",
      verdict: v as AiryVerdict,
      confidence: storedConfidence,
      notes: String(claim?.ai_notes || ""),
      mismatches: [],
      tamperSignals: [],
      provider: "stored",
      model: "stored",
      extracted: null,
      receiptReadable: true,
      readabilityIssue: null,
      override: claim?.ai_override === true,
      overrideBy: null,
      overrideReason: null,
      overriddenAt: null,
    };
  }

  return { status: "idle" };
}
