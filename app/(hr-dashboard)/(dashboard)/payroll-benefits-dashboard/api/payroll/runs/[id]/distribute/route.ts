import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/(hr-dashboard)/supabase/admin-client";
import { sendPayslipEmailWithPdf } from "@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/lib/mailer";
import { buildPayslipPdf } from "@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/lib/payslipPdf";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SENDS = 3;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function birthdatePassword(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${String(
    d.getFullYear()
  ).slice(-2)}`;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function periodLabelFromDates(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const month = s.toLocaleDateString("en-PH", { month: "long" }).toUpperCase();
  return `${month} ${s.getDate()}-${e.getDate()}, ${e.getFullYear()}`;
}

function cutOffFromDates(start: string, end: string): string {
  const s = new Date(start).toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const e = new Date(end).toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `${s} - ${e}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const runId = Number(id);
    if (!runId || isNaN(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }

    const { data: run, error: runErr } = await supabaseAdmin
      .from("hr4_payroll_runs")
      .select("id, period_start, period_end, approval_status, distribute_count")
      .eq("id", runId)
      .single();

    if (runErr || !run) {
      return NextResponse.json(
        { error: "Payroll run not found" },
        { status: 404 }
      );
    }

    if (
      run.approval_status !== "approved" &&
      run.approval_status !== "distributed"
    ) {
      return NextResponse.json(
        { error: "Run must be approved by Financial before distributing." },
        { status: 400 }
      );
    }

    const currentCount = Number(run.distribute_count || 0);
    if (currentCount >= MAX_SENDS) {
      return NextResponse.json(
        {
          error: `Distribution limit reached. This run has already been sent ${MAX_SENDS} times.`,
          send_count: currentCount,
          max_sends: MAX_SENDS,
          can_send_more: false,
        },
        { status: 429 }
      );
    }

    const { data: payslips, error: slipErr } = await supabaseAdmin
      .from("hr4_payslips")
      .select(
        `*,
        hr1_employees (
          id, first_name, last_name, employee_id_number, birthdate, email, department,
          hr1_job_positions ( title, department )
        )`
      )
      .eq("payroll_run_id", runId);

    if (slipErr) {
      return NextResponse.json({ error: slipErr.message }, { status: 500 });
    }

    if (!payslips || payslips.length === 0) {
      return NextResponse.json(
        { error: "No payslips found for this run." },
        { status: 400 }
      );
    }

    const periodLabel = periodLabelFromDates(run.period_start, run.period_end);
    const cutOff = cutOffFromDates(run.period_start, run.period_end);

    let sent = 0;
    let failed = 0;
    const failedList: Array<{ name: string; email: string; reason: string }> =
      [];

    for (const slip of payslips) {
      const emp = Array.isArray(slip.hr1_employees)
        ? slip.hr1_employees[0]
        : slip.hr1_employees;

      if (!emp?.email) {
        failed++;
        failedList.push({
          name: emp ? `${emp.first_name} ${emp.last_name}` : "Unknown",
          email: "—",
          reason: "No email on file",
        });
        continue;
      }

      if (!emp.birthdate) {
        failed++;
        failedList.push({
          name: `${emp.first_name} ${emp.last_name}`,
          email: emp.email,
          reason: "No birthdate set — PDF password cannot be generated",
        });
        continue;
      }

      const password = birthdatePassword(emp.birthdate);
      if (!password) {
        failed++;
        failedList.push({
          name: `${emp.first_name} ${emp.last_name}`,
          email: emp.email,
          reason: "Invalid birthdate format",
        });
        continue;
      }

      const job = Array.isArray(emp.hr1_job_positions)
        ? emp.hr1_job_positions[0]
        : emp.hr1_job_positions;

      const dailyRate = num(slip.daily_rate);
      const daysWorked = num(slip.days_worked);
      const overtimeHours = num(slip.overtime_hours);
      const hoursPerDay =
        num(slip.hours_worked) > 0 && num(slip.regular_hours) > 0
          ? (num(slip.hours_worked) /
              Math.max(1, num(slip.regular_hours) + num(slip.overtime_hours))) *
            8
          : 8;
      const hourlyRate = dailyRate > 0 ? dailyRate / (hoursPerDay || 8) : 0;
      const overtime = overtimeHours * hourlyRate * 1.25;

      const basicPay = num(slip.basic_pay);
      const totalPay = basicPay + overtime;

      const nightDiff = num(slip.night_diff_pay);
      const holiday = num(slip.holiday_pay);
      const allowances = num(slip.allowances_pay);
      const bonus = num(slip.bonus_pay);
      const incentives = num(slip.incentive_pay);

      const grossTotal =
        num(slip.gross_pay) ||
        totalPay + nightDiff + holiday + allowances + bonus + incentives;

      const sss = num(slip.sss_employee_share);
      const philhealth = num(slip.philhealth_employee_share);
      const pagibig = num(slip.pagibig_employee_share);
      const withholdingTax = num(slip.withholding_tax);
      const otherDeductions = num(slip.other_deductions);
      const totalDeduction =
        num(slip.total_deductions) ||
        sss + philhealth + pagibig + withholdingTax + otherDeductions;

      const netPay = num(slip.net_pay) || grossTotal - totalDeduction;

      try {
        const pdfBytes = await buildPayslipPdf(
          {
            periodLabel,
            employee: {
              email: emp.email,
              name: `${emp.last_name?.toUpperCase() || ""}, ${
                emp.first_name?.toUpperCase() || ""
              }`
                .replace(/^, |, $/g, "")
                .trim(),
              position: job?.title || "—",
              idNumber: emp.employee_id_number || "",
              cutOff,
              dailyRate: dailyRate > 0 ? dailyRate : null,
            },
            earnings: {
              totalPay,
              daysWorked,
              overtime,
              regularHoliday: holiday,
              specialHoliday: 0,
              incentives,
              load: 0,
              transpo: allowances,
              miscellaneous: bonus,
              gas: 0,
              adjustment: 0,
            },
            deductions: {
              sss,
              pagibig,
              philhealth,
              sssLoan: 0,
              pagibigLoan: 0,
              cashAdvanceBalance: 0,
              tardiness: 0,
              penalty: 0,
              employeeSavings: 0,
              excess: 0,
            },
            grossTotal,
            totalDeduction,
            netPay,
          },
          password
        );

        await sendPayslipEmailWithPdf({
          to: emp.email,
          employeeName: `${emp.first_name} ${emp.last_name}`,
          periodStart: run.period_start,
          periodEnd: run.period_end,
          netPay,
          pdfBytes,
          employeeIdNumber: emp.employee_id_number || "",
        });

        await supabaseAdmin.from("hr4_payslip_distributions").upsert(
          {
            payroll_run_id: runId,
            employee_id: slip.employee_id,
            payslip_id: slip.id,
            email: emp.email,
            status: "sent",
            sent_at: new Date().toISOString(),
          },
          { onConflict: "payslip_id" }
        );

        sent++;
      } catch (err: any) {
        failed++;
        failedList.push({
          name: `${emp.first_name} ${emp.last_name}`,
          email: emp.email,
          reason: err?.message || "Send failed",
        });

        await supabaseAdmin.from("hr4_payslip_distributions").upsert(
          {
            payroll_run_id: runId,
            employee_id: slip.employee_id,
            payslip_id: slip.id,
            email: emp.email,
            status: "failed",
            error_message: err?.message || "Send failed",
          },
          { onConflict: "payslip_id" }
        );
      }
    }

    const newCount = sent > 0 ? currentCount + 1 : currentCount;

    if (sent > 0) {
      await supabaseAdmin
        .from("hr4_payroll_runs")
        .update({
          distribute_count: newCount,
          distributed_at: new Date().toISOString(),
          approval_status: "distributed",
        })
        .eq("id", runId);
    }

    return NextResponse.json({
      sent,
      failed,
      failedList,
      send_count: newCount,
      max_sends: MAX_SENDS,
      can_send_more: newCount < MAX_SENDS,
      remaining_sends: Math.max(0, MAX_SENDS - newCount),
    });
  } catch (error: any) {
    console.error("POST /distribute error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
