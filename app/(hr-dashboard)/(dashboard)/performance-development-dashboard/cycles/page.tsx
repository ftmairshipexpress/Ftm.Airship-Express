import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/(hr-dashboard)/supabase/admin-client";
import { requireHrAdmin } from "@/performance-development-dashboard/lib/auth/hrIdentity";
import { listPerformanceCycles } from "@/performance-development-dashboard/lib/performance/cycles";
import { CycleManagement } from "@/performance-development-dashboard/components/performance-cycle/CycleManagement";
import type { CurrentPerDevUser } from "@/performance-development-dashboard/types";

export const dynamic = "force-dynamic";

function fullName(firstName: string | null, lastName: string | null): string {
  return `${firstName ?? ""} ${lastName ?? ""}`.trim();
}

export default async function PerformanceCyclesPage() {
  const auth = await requireHrAdmin();

  if (auth instanceof NextResponse) {
    redirect("/hrAuth");
  }

  const serverUser: CurrentPerDevUser = {
    fullName: auth.fullName,
    role: auth.role,
    email: auth.email,
  };

  const cycles = await listPerformanceCycles();

  if (cycles instanceof NextResponse) {
    return (
      <CycleManagement
        serverUser={serverUser}
        initialCycles={[]}
        initialError="Failed to load performance cycles. Please try again."
      />
    );
  }

  // Employee directory for read-only pre-confirm verification rows
  // (names/ID numbers in Advance/Close confirmations). Same
  // supabaseAdmin directory pattern the appraisals page uses; no endpoint,
  // rule, or schema change — presentation data for an HR-admin page.
  const employeeNamesById: Record<string, string> = {};
  const employeeIdNumbersById: Record<string, string> = {};
  const { data: directory } = await supabaseAdmin
    .from("hr1_employees")
    .select("id, first_name, last_name, employee_id_number");
  for (const employee of (directory ?? []) as unknown as Array<{
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

  return (
    <CycleManagement
      serverUser={serverUser}
      initialCycles={cycles}
      employeeNamesById={employeeNamesById}
      employeeIdNumbersById={employeeIdNumbersById}
    />
  );
}