import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/(hr-dashboard)/supabase/admin-client";
import { requireAdmin } from "@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/lib/auth/requireAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function extractIdFromUrl(url: string): string | null {
  const parts = url.split("/");
  return parts[parts.length - 2] || null;
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdmin(request);
    if (authResult instanceof NextResponse) return authResult;

    const id = extractIdFromUrl(request.url);
    if (!id) {
      return NextResponse.json(
        { error: "Payroll run ID is required" },
        { status: 400 }
      );
    }

    const runId = Number(id);
    if (isNaN(runId)) {
      return NextResponse.json(
        { error: "Invalid payroll run ID" },
        { status: 400 }
      );
    }

    const { data: run, error: runErr } = await supabaseAdmin
      .from("hr4_payroll_runs")
      .select(
        "id, period_start, period_end, pay_schedule, status, approval_status"
      )
      .eq("id", runId)
      .single();

    if (runErr || !run) {
      return NextResponse.json(
        { error: runErr?.message || "Payroll run not found" },
        { status: 404 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("hr4_payslips")
      .select(
        `
        id, payroll_run_id, employee_id,
        basic_pay, gross_pay,
        sss_employee_share, sss_employer_share,
        philhealth_employee_share, philhealth_employer_share,
        pagibig_employee_share, pagibig_employer_share,
        withholding_tax, other_deductions, total_deductions, net_pay,
        daily_rate, days_worked, hours_worked,
        regular_hours, overtime_hours,
        night_diff_hours, night_diff_pay,
        holiday_hours, holiday_pay,
        allowances_pay, bonus_pay, incentive_pay,
        created_at,
        hr1_employees (
          first_name, last_name, employee_id_number, department,
          hr1_job_positions ( title, department )
        )
      `
      )
      .eq("payroll_run_id", runId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data || []).map((row: any) => {
      const emp = Array.isArray(row.hr1_employees)
        ? row.hr1_employees[0]
        : row.hr1_employees;
      const job = emp?.hr1_job_positions
        ? Array.isArray(emp.hr1_job_positions)
          ? emp.hr1_job_positions[0]
          : emp.hr1_job_positions
        : null;

      return {
        ...row,
        employee_name: emp
          ? `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim()
          : null,
        employee_id_number: emp?.employee_id_number ?? null,
        job_title: job?.title ?? null,
        department: job?.department ?? emp?.department ?? null,
        pay_schedule: run.pay_schedule ?? null,
        period_start: run.period_start ?? null,
        period_end: run.period_end ?? null,
        hr1_employees: undefined,
      };
    });

    return NextResponse.json(rows, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("GET /payslips error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
