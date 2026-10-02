import Link from "next/link";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/(hr-dashboard)/supabase/admin-client";
import { requireHrAdmin } from "@/performance-development-dashboard/lib/auth/hrIdentity";
import { listPerformanceCycles } from "@/performance-development-dashboard/lib/performance/cycles";
import { listAppraisals } from "@/performance-development-dashboard/lib/performance/appraisals";
import { CycleHistoryView } from "@/performance-development-dashboard/components/performance-cycle/CycleHistoryView";
import type { PerformanceAppraisal } from "@/performance-development-dashboard/types";

export const dynamic = "force-dynamic";

function fullName(firstName: string | null, lastName: string | null): string {
  return `${firstName ?? ""} ${lastName ?? ""}`.trim();
}

/**
 * Read-only historical cycle inspection (HR Admin only).
 *
 * Reuses the existing server libraries with zero API/business-logic
 * changes: the cycle comes from `listPerformanceCycles`, appraisals come
 * from `listAppraisals` filtered to this cycle in plain JS (the list
 * endpoint exposes no cycle filter and none is added), and employee
 * identity follows the appraisals-page directory pattern. Active cycles
 * redirect back to the list — only Closed cycles render here, and the
 * view itself offers no mutation actions.
 */
export default async function CycleHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const auth = await requireHrAdmin();
  if (auth instanceof NextResponse) {
    redirect("/hrAuth");
  }

  const cyclesResult = await listPerformanceCycles();
  const cycles = cyclesResult instanceof NextResponse ? [] : cyclesResult;
  const cycle = cycles.find((item) => item.id === id) ?? null;

  if (!cycle) {
    return (
      <div className="space-y-4">
        <Link
          href="/performance-development-dashboard/cycles"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
        >
          ← Performance Cycles
        </Link>
        <div className="rounded-2xl border border-line bg-paper px-5 py-10 text-center dark:border-paper/10">
          <p className="font-bricolage text-[18px] font-medium tracking-tight text-ink">
            Cycle not found
          </p>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
            This performance cycle does not exist or is outside your current
            scope.
          </p>
        </div>
      </div>
    );
  }

  // Historical view is for Closed cycles only; active cycles keep their
  // live card actions on the list page.
  if (cycle.stage !== "closed") {
    redirect("/performance-development-dashboard/cycles");
  }

  const appraisalsResult = await listAppraisals({});
  const appraisals: PerformanceAppraisal[] =
    appraisalsResult instanceof NextResponse
      ? []
      : appraisalsResult.filter((appraisal) => appraisal.cycle_id === id);

  const employeeIds = [
    ...new Set(
      appraisals
        .flatMap((appraisal) => [
          appraisal.employee_id,
          appraisal.reviewer_id,
          appraisal.evaluator_id,
        ])
        .filter(Boolean),
    ),
  ] as string[];

  const employeeNamesById: Record<string, string> = {};
  const employeeIdNumbersById: Record<string, string> = {};
  if (employeeIds.length > 0) {
    const { data } = await supabaseAdmin
      .from("hr1_employees")
      .select("id, first_name, last_name, employee_id_number")
      .in("id", employeeIds);
    for (const employee of (data ?? []) as unknown as Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      employee_id_number: string | null;
    }>) {
      const name = fullName(employee.first_name, employee.last_name);
      if (name) employeeNamesById[employee.id] = name;
      if (employee.employee_id_number) {
        employeeIdNumbersById[employee.id] = employee.employee_id_number;
      }
    }
  }

  return (
    <CycleHistoryView
      cycle={cycle}
      appraisals={appraisals}
      employeeNamesById={employeeNamesById}
      employeeIdNumbersById={employeeIdNumbersById}
    />
  );
}
