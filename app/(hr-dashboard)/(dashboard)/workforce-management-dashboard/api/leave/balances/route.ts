import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

export async function GET() {
  const supabase = getSupabaseAdmin();
  // Fetch employees and join balances
  const { data, error } = await supabase
    .from('hr1_employees')
    .select('id, first_name, last_name, department, job_position:hr1_job_positions(title), hr2_leave_balances(*)')
    .order('first_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const formatted = (data || []).map(emp => {
      const b = (emp.hr2_leave_balances && emp.hr2_leave_balances.length > 0) ? emp.hr2_leave_balances[0] : {};
      return {
          id: emp.id,
          full_name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Employee',
          role: emp.job_position?.title || emp.department || 'Staff',
          department: emp.department || 'Operations',
          vacation_total: b.vacation_total ?? 15,
          vacation_used: b.vacation_used ?? 0,
          sick_total: b.sick_total ?? 15,
          sick_used: b.sick_used ?? 0,
          maternity_total: b.maternity_total ?? 105,
          maternity_used: b.maternity_used ?? 0,
          paternity_total: b.paternity_total ?? 7,
          paternity_used: b.paternity_used ?? 0,
          bereavement_total: b.bereavement_total ?? 3,
          bereavement_used: b.bereavement_used ?? 0,
      }
  });

  return NextResponse.json({ data: formatted });
}
