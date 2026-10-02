import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../lib/supabaseAdmin';
import { getRequestProfileAppRouter } from '../../lib/apiAuthAppRouter';
import { canCreateShifts } from '../../utils/rbac';


function force12HourFormat(timeStr: string | null | undefined): string | null {
  if (!timeStr) return timeStr || null;
  // Handle range "19:00 - 20:00" or single "19:00"
  const parts = timeStr.split(' - ');
  const convertSingle = (t: string) => {
    t = t.trim();
    // If it already explicitly has AM/PM, leave it (unless it's like 19:00 PM which is invalid, but let's try to fix)
    const ampmMatch = t.match(/AM|PM/i);
    let rawTime = t.replace(/AM|PM/i, '').trim();
    let [hStr, mStr, sStr] = rawTime.split(':');
    if (!hStr) return t;
    let h = parseInt(hStr, 10);
    if (isNaN(h)) return t;
    
    // If original string didn't have AM/PM, it was likely 24h format. 
    // If it DID have AM/PM, we assume it's already correct (unless h > 12).
    let isPM = h >= 12;
    if (ampmMatch && h <= 12) {
      isPM = ampmMatch[0].toUpperCase() === 'PM';
    }
    
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    
    return `${h.toString().padStart(2, '0')}:${mStr || '00'} ${isPM ? 'PM' : 'AM'}`;
  };
  
  return parts.map(convertSingle).join(' - ');
}

const formatShift = (row: any) => {

  if (!row) return row;
  const emp = row.employee;
  const mappedEmployee = emp
    ? {
        id: emp.id,
        email: emp.email || '',
        full_name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Employee',
        role: emp.job_position?.title || emp.department || 'Staff',
        avatar_initials: `${emp.first_name?.[0] || ''}${emp.last_name?.[0] || ''}`.toUpperCase() || 'E',
        department: emp.department || 'HQ',
        created_at: emp.date_hired || row.created_at,
      }
    : undefined;
  
  // Note: fleet_data is not in DB anymore. It's simulated or fetched from fleet. We'll leave it undefined here for real data unless we fetch it from Fleet.
  
  return { 
    ...row, 
    employee: mappedEmployee,
    shift_time: force12HourFormat(row.shift_time),
    break_time: force12HourFormat(row.break_time)
  };

};

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('hr2_shifts')
    .select('*, employee:hr1_employees(*, job_position:hr1_job_positions(title))')
    .order('shift_date', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: (data || []).map(formatShift) });
}

export async function POST(request: NextRequest) {
  const auth = await getRequestProfileAppRouter();
  if (!canCreateShifts(auth.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }
  const body = await request.json();
  const { title, employee_id, shift_date, dates, shift_time, break_time, status, override_reason, is_recurring, recurring_days } = body;
  
  if (!shift_date || !shift_time) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  
  const supabase = getSupabaseAdmin();

  // If recurring, insert EXACTLY 1 row representing the recurring contract
  if (is_recurring) {
    const row = {
      title,
      employee_id: employee_id || null,
      shift_date,
      shift_time,
      break_time,
      status: status || 'Scheduled',
      priority: 'Normal',
      override_reason,
      is_recurring: true,
      recurring_days: recurring_days || null,
    };

    const { data, error } = await supabase
      .from('hr2_shifts')
      .insert(row)
      .select('*, employee:hr1_employees(*, job_position:hr1_job_positions(title))')
      .single();
      
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: formatShift(data) }, { status: 201 });
  }

  // Batch insert for bounded range shifts
  const allDates: string[] = (dates && dates.length > 1) ? dates : [shift_date];
  const rows = allDates.map((d: string) => ({
    title,
    employee_id: employee_id || null,
    shift_date: d,
    shift_time,
    break_time,
    status: status || 'Scheduled',
    priority: 'Normal',
    override_reason,
    is_recurring: false,
    recurring_days: null,
  }));

  const { data, error } = await supabase
    .from('hr2_shifts')
    .insert(rows)
    .select('*, employee:hr1_employees(*, job_position:hr1_job_positions(title))');
    
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const formatted = (data || []).map(formatShift);
  return NextResponse.json({ data: formatted.length === 1 ? formatted[0] : formatted }, { status: 201 });
}
