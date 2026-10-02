import { NextRequest, NextResponse } from "next/server";
import { deleteCompetencyApplicability } from "@/performance-development-dashboard/lib/performance/applicability";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    // The service returns the final response in every case: 200 with
    // `{ success: true }` on deletion, or the 4xx/5xx denial/failure.
    return await deleteCompetencyApplicability(id);
  } catch (error) {
    console.error(
      "DELETE /api/performance/competency-applicability/[id] error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
