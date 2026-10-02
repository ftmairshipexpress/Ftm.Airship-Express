import { NextRequest, NextResponse } from "next/server";
import {
  updatePositionAppraisalWeights,
  type UpdatePositionAppraisalWeightsInput,
} from "@/performance-development-dashboard/lib/performance/positionWeights";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
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
    const { id } = await context.params;

    const weights = await updatePositionAppraisalWeights(
      id,
      rawBody as UpdatePositionAppraisalWeightsInput
    );
    if (weights instanceof NextResponse) return weights;

    return NextResponse.json(weights);
  } catch (error) {
    console.error(
      "PATCH /api/performance/position-weights/[id] error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
