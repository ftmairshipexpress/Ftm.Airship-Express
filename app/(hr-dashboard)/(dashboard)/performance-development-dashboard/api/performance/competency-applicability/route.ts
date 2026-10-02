import { NextRequest, NextResponse } from "next/server";
import {
  createCompetencyApplicability,
  listCompetencyApplicability,
  type CompetencyApplicabilityInput,
  type LibraryApplicabilityScope,
} from "@/performance-development-dashboard/lib/performance/applicability";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const assignments = await listCompetencyApplicability({
      competency_id: searchParams.get("competency_id"),
      scope: searchParams.get("scope") as LibraryApplicabilityScope | null,
    });
    if (assignments instanceof NextResponse) return assignments;

    return NextResponse.json(assignments);
  } catch (error) {
    console.error(
      "GET /api/performance/competency-applicability error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isRecord(rawBody)) {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  try {
    const assignment = await createCompetencyApplicability(
      rawBody as CompetencyApplicabilityInput
    );
    if (assignment instanceof NextResponse) return assignment;

    return NextResponse.json(assignment, { status: 201 });
  } catch (error) {
    console.error(
      "POST /api/performance/competency-applicability error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
