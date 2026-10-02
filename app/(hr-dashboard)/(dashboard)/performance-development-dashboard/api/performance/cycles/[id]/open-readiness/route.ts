import { NextRequest, NextResponse } from "next/server";
import { getCycleOpenReadiness } from "@/performance-development-dashboard/lib/performance/cycles";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Read-only open-readiness report for HR planning UI. Reuses the exact
 * validation the open operation enforces; performs no writes and records
 * no audit event.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    const readiness = await getCycleOpenReadiness(id);
    if (readiness instanceof NextResponse) return readiness;

    return NextResponse.json(readiness);
  } catch (error) {
    console.error(
      "GET /api/performance/cycles/[id]/open-readiness error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
