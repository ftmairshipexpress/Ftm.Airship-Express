import { NextRequest, NextResponse } from "next/server";
import {
  createPositionAppraisalWeights,
  listPositionAppraisalWeights,
  type PositionAppraisalWeightsInput,
} from "@/performance-development-dashboard/lib/performance/positionWeights";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET() {
  try {
    const weights = await listPositionAppraisalWeights();
    if (weights instanceof NextResponse) return weights;

    return NextResponse.json(weights);
  } catch (error) {
    console.error(
      "GET /api/performance/position-weights error:",
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
    const weights = await createPositionAppraisalWeights(
      rawBody as PositionAppraisalWeightsInput
    );
    if (weights instanceof NextResponse) return weights;

    return NextResponse.json(weights, { status: 201 });
  } catch (error) {
    console.error(
      "POST /api/performance/position-weights error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
