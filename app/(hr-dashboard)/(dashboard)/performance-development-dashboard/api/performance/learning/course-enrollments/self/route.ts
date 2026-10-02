import { NextRequest, NextResponse } from "next/server";
import { createOwnCourseEnrollment } from "@/performance-development-dashboard/lib/performance/learning";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Employee self-enrollment. The employee_id is derived server-side from the
 * authenticated employee context — any client-supplied employee id is never
 * read. The course must exist and allow self-enrollment; duplicates 409.
 */
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
    const enrollment = await createOwnCourseEnrollment(rawBody);
    if (enrollment instanceof NextResponse) return enrollment;

    return NextResponse.json(enrollment, { status: 201 });
  } catch (error) {
    console.error(
      "POST /api/performance/learning/course-enrollments/self error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
