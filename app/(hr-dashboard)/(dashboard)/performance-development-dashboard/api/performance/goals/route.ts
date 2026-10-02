import { NextRequest, NextResponse } from "next/server";
import {
  createPerformanceGoal,
  listPerformanceGoals,
  type CreatePerformanceGoalInput,
  type ListPerformanceGoalsQuery,
} from "@/performance-development-dashboard/lib/performance/goals";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const query: ListPerformanceGoalsQuery = {};
    const employeeId = searchParams.get("employee_id");
    const status = searchParams.get("status");
    const cycleId = searchParams.get("cycle_id");
    const scope = searchParams.get("scope");
    const department = searchParams.get("department");

    if (employeeId) query.employee_id = employeeId;
    if (status) query.status = status;
    if (cycleId) query.cycle_id = cycleId;
    if (scope) query.scope = scope;
    if (department) query.department = department;

    const goals = await listPerformanceGoals(query);
    if (goals instanceof NextResponse) return goals;

    return NextResponse.json(goals);
  } catch (error) {
    console.error("GET /api/performance/goals error:", error);
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
    // Department-scope context for creation (HR Department tab). Forwarded
    // as input so createPerformanceGoal can enforce assignee membership
    // server-side; absent scope preserves org-wide assignment.
    const scopeParam = request.nextUrl.searchParams.get("scope");
    const departmentParam = request.nextUrl.searchParams.get("department");
    const input: CreatePerformanceGoalInput = { ...rawBody };
    if (scopeParam !== null) input.scope = scopeParam;
    if (departmentParam !== null) input.department = departmentParam;

    const goal = await createPerformanceGoal(input);
    if (goal instanceof NextResponse) return goal;

    return NextResponse.json(goal, { status: 201 });
  } catch (error) {
    console.error("POST /api/performance/goals error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}