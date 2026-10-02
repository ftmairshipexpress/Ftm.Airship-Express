import { NextRequest, NextResponse } from "next/server";
import { advanceDevPlanFollowThrough } from "@/performance-development-dashboard/lib/performance/developmentFollowThrough";
import type { DevPlanItemStatus } from "@/performance-development-dashboard/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Employee follow-through transition for ONE finalized development action.
 *
 * POST /api/performance/development-plan-items/[id]/follow-through
 * Body: `{ "status": "in_progress" | "completed" }`
 *
 * Deliberately separate from PATCH
 * `/api/performance/development-plan-items/[id]` (whose `finalized_at` guard
 * stays closed): this route can only advance `status` one forward step on the
 * actor's OWN finalized appraisal item. Content fields are rejected here —
 * `action`, `target`, `employee_id`, and `appraisal_id` can never be modified
 * through follow-through.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    if (!isRecord(body)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object." },
        { status: 400 },
      );
    }

    // Content immutability: only `status` is accepted. Any attempt to carry
    // content/ownership fields is rejected rather than ignored.
    const forbiddenFields = [
      "action",
      "target",
      "employee_id",
      "appraisal_id",
      "id",
      "created_at",
      "updated_at",
    ].filter((field) => body[field] !== undefined);
    if (forbiddenFields.length > 0) {
      return NextResponse.json(
        {
          error: `Only status can be updated through follow-through. Forbidden fields: ${forbiddenFields.join(", ")}.`,
        },
        { status: 400 },
      );
    }

    if (typeof body.status !== "string" || !body.status) {
      return NextResponse.json(
        { error: "status is required." },
        { status: 400 },
      );
    }

    const item = await advanceDevPlanFollowThrough(id, {
      status: body.status as DevPlanItemStatus,
    });
    if (item instanceof NextResponse) return item;

    return NextResponse.json(item);
  } catch (error) {
    console.error(
      "POST /api/performance/development-plan-items/[id]/follow-through error:",
      error,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
