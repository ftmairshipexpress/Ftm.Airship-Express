import { NextRequest, NextResponse } from "next/server";
import { finalizeAppraisal } from "@/performance-development-dashboard/lib/performance/appraisals";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

import type { FinalizeAppraisalInput } from "@/performance-development-dashboard/lib/performance/appraisals";

/**
 * Finalize an appraisal.
 *
 * Reads existing Manager-persisted goal and competency ratings from the
 * appraisal result tables and computes the official final score.
 * No scoring input is required in the request body.
 *
 * Optional override body (HR administrative fallback only):
 * `{ "override_acknowledgment": true, "override_reason": "<non-empty>" }`
 * finalizes a submitted-but-unacknowledged manager assessment. The service
 * validates the flag, the reason, and actual submission; all other rules
 * are unchanged.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    let input: FinalizeAppraisalInput = {};
    try {
      const rawBody: unknown = await request.json();
      if (rawBody !== null && typeof rawBody === "object") {
        input = rawBody as FinalizeAppraisalInput;
      }
    } catch {
      input = {};
    }

    const appraisal = await finalizeAppraisal(id, input);
    if (appraisal instanceof NextResponse) return appraisal;

    return NextResponse.json(appraisal);
  } catch (error) {
    console.error(
      "POST /api/performance/appraisals/[id]/finalize error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}