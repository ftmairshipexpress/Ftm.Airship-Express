import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('hr2_leave_requests')
    .select('*, employee:hr1_employees(id, first_name, last_name, department, job_position:hr1_job_positions(title))')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const mapped = (data || []).map((req: any) => {
    const emp = req.employee;
    return {
      ...req,
      employee: emp
        ? {
            ...emp,
            full_name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Employee',
            role: emp.job_position?.title || emp.department || 'Staff',
          }
        : null,
    };
  });

  return NextResponse.json({ data: mapped });
}
