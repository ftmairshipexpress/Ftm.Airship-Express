import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';

export async function GET() {
  const admin = getSupabaseAdmin();

  const [
    { data: employees, error: dErr },
    { data: attendance, error: aErr },
  ] = await Promise.all([
    admin
      .from('hr1_employees')
      .select('id, first_name, last_name, department, job_position:hr1_job_positions(title), fatigue_status, hours_worked_7d')
      .order('first_name'),
    admin.from('hr2_attendance_logs').select('employee_id').eq('status', 'On-Shift'),
  ]);

  if (dErr || aErr) {
    return NextResponse.json({ error: dErr?.message ?? aErr?.message }, { status: 500 });
  }

  const onShift = new Set((attendance ?? []).map((r) => r.employee_id));

  const driverList = (employees ?? []).map((emp: any) => {
    const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Driver';
    const role = emp.job_position?.title || emp.department || 'Fleet Driver';
    return {
      id: emp.id,
      full_name: fullName,
      role,
      department: emp.department || 'Operations',
      terminal: emp.department || 'HQ',
      on_shift: onShift.has(emp.id),
      fatigue_status: emp.fatigue_status || 'OK',
      hours_worked_7d: emp.hours_worked_7d || 0,
    };
  });

  return NextResponse.json({ data: driverList });
}
