import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { canManageAttendance } from '../../../utils/rbac';
import { getRequestProfileAppRouter } from '../../../lib/apiAuthAppRouter';
import { z } from 'zod';

const ManualOverrideSchema = z.object({
  employee_id: z.string().uuid(),
  action: z.enum(['Clock In', 'Clock Out']),
  punch_time: z.string().datetime(),
  manual_override_reason: z.enum(['HARDWARE_OFFLINE', 'NETWORK_LATENCY', 'LOST_BADGE', 'MAINTENANCE', 'OTHER']),
  manual_override_notes: z.string().trim().min(15, "Notes must be at least 15 characters to provide adequate context"),
});

export async function POST(request: Request) {
  try {
    const auth = await getRequestProfileAppRouter();
    if (!canManageAttendance(auth.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    
    // Server-side Zod validation
    const parsed = ManualOverrideSchema.parse(body);
    const supabase = getSupabaseAdmin();
    
    // RFID Constraint Check
    const { data: rfidData, error: rfidError } = await supabase
      .from('hr2_rfid_bind')
      .select('id')
      .eq('employee_id', parsed.employee_id)
      .eq('card_status', 'Active')
      .single();
      
    if (rfidError || !rfidData) {
      return NextResponse.json({ error: 'Employee must have an active registered RFID tag before manual bypass can be used.' }, { status: 400 });
    }
    
    const punchDate = new Date(parsed.punch_time);

    if (parsed.action === 'Clock In') {
      // Determine if they are tardy based on the punch time, not the current time!
      const status = 'On-Shift'; // Bypass Tardy check for manual overrides

      const { data, error } = await supabase
        .from('hr2_attendance_logs')
        .insert({
          employee_id: parsed.employee_id,
          status,
          shift_start: '09:00:00',
          shift_end: '18:00:00',
          terminal: 'HQ (Manual)',
          time_in: punchDate.toISOString(),
          last_scan: punchDate.toISOString(),
          is_manual_override: true,
          manual_override_by: auth.id,
          manual_override_at: new Date().toISOString(), // Actual server time of insertion
          manual_override_reason: parsed.manual_override_reason,
          manual_override_notes: parsed.manual_override_notes,
        })
        .select()
        .single();
        
      if (error) throw error;
      return NextResponse.json({ data });

    } else {
      // Clock Out - Find today's open shift and patch it
      const startOfDay = new Date(punchDate);
      startOfDay.setHours(0, 0, 0, 0);

      const { data: logs, error: searchError } = await supabase
        .from('hr2_attendance_logs')
        .select('*')
        .eq('employee_id', parsed.employee_id)
        .gte('created_at', startOfDay.toISOString())
        .order('created_at', { ascending: false })
        .limit(1);

      if (searchError) throw searchError;
      if (!logs || logs.length === 0) {
        return NextResponse.json({ error: 'No active clock-in found for today to clock out from.' }, { status: 400 });
      }

      const { data, error } = await supabase
        .from('hr2_attendance_logs')
        .update({
          status: 'Clocked Out',
          time_out: punchDate.toISOString(),
          last_scan: punchDate.toISOString(),
          is_manual_override: true,
          manual_override_by: auth.id,
          manual_override_at: new Date().toISOString(),
          manual_override_reason: parsed.manual_override_reason,
          manual_override_notes: parsed.manual_override_notes,
        })
        .eq('id', logs[0].id)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ data });
    }
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
