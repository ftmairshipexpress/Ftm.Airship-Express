'use server';

import { loadKnowledgeServer } from '../knowledge/serverLoader';

export type MeritVerifyVerdict = {
    ok: true;
    consistent: boolean;
    confidence: number;          // 0..1
    verdict: 'approve' | 'review' | 'reject';
    mismatches: Array<{ field: string; claimed: string; found: string; severity: 'low' | 'medium' | 'high' }>;
    tamper_signals: string[];
    notes: string;
    provider: string;
    model: string;
};

function deriveConfidence(parsed: any): number {
    const raw = typeof parsed?.confidence === 'number' ? parsed.confidence : 0;
    const c = Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw));
    const hasProblem =
        (parsed?.mismatches?.length ?? 0) > 0 ||
        (parsed?.tamper_signals?.length ?? 0) > 0 ||
        parsed?.consistent === false;
    if (c >= 0.9 && hasProblem) return Math.min(c, 0.79);
    return c;
}

export async function verifyMeritPlan(input: {
    employeeName: string;
    employeeNumber: string | null;
    performanceRating: number;
    policyPercent: number;
    currentSalary: number;
    increasePercent: number;
    newSalary: number;
    approverNotes: string;
    effectiveDate: string;
    status: string;
}): Promise<MeritVerifyVerdict | { ok: false; error: string }> {
    try {
        const kb = loadKnowledgeServer('merit-verifier');
        const prompt =
            (kb ??
                `You are Airy, auditing a merit-increase plan for Airship Express. ` +
                `Return STRICT JSON: { consistent: boolean, confidence: number (0-1), ` +
                `verdict: "approve"|"review"|"reject", mismatches: [], tamper_signals: [], notes: string }. ` +
                `Rules: approve only when newSalary = currentSalary*(1+pct/100) within 0.5%, ` +
                `pct is within ±0.5 of policyPercent, rating matches, and notes are non-empty. ` +
                `Confidence ≤ 0.79 if any mismatch. Confidence ≤ 0.54 if tamper_signals.`) +
            `\n\n---\nPLAN DATA\n` +
            JSON.stringify(input, null, 2);

        // Re-use your existing text chat provider — replace with your actual import.
        const { visionChat } = await import('../providers');
        // visionChat expects an image; for text-only use your text provider.
        // If you have a `textChat`, swap it in here:
        const res = await (await import('../providers')).textChat?.({
            prompt,
            maxTokens: 700,
        }) ?? await visionChat({
            prompt,
            imageBase64: '',      // no image
            mimeType: 'text/plain',
            maxTokens: 700,
        });

        let parsed: any;
        try { parsed = JSON.parse(res.content); }
        catch { return { ok: false, error: 'AI returned non-JSON.' }; }

        return {
            ok: true,
            consistent: !!parsed.consistent,
            confidence: deriveConfidence(parsed),
            verdict:
                parsed.verdict === 'approve' || parsed.verdict === 'review' || parsed.verdict === 'reject'
                    ? parsed.verdict : 'review',
            mismatches: Array.isArray(parsed.mismatches) ? parsed.mismatches : [],
            tamper_signals: Array.isArray(parsed.tamper_signals) ? parsed.tamper_signals : [],
            notes: parsed.notes ?? '',
            provider: res.provider,
            model: res.model,
        };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? 'Merit verification failed.' };
    }
}