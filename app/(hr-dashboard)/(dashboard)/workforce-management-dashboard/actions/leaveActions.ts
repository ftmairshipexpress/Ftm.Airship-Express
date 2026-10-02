'use server';

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  (process.env.NEXT_PUBLIC_HR_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
  (process.env.HR_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!
);

export async function approveLeaveRequest(leaveId: string, employeeId: string, leaveType: string, daysCount: number) {
  try {
    // 1. Update Request Status
    const { error: reqError } = await supabaseAdmin
      .from('hr2_leave_requests')
      .update({ status: 'Approved' })
      .eq('id', leaveId);

    if (reqError) throw reqError;

    // 2. Fetch Current Balances
    const { data: balance, error: balError } = await supabaseAdmin
      .from('hr2_leave_balances')
      .select('*')
      .eq('employee_id', employeeId)
      .single();

    if (balError && balError.code !== 'PGRST116') {
      throw balError;
    }

    let updates: any = {};
    if (balance) {
      if (leaveType === 'Sick') updates.sick_used = (balance.sick_used || 0) + daysCount;
      if (leaveType === 'Vacation') updates.vacation_used = (balance.vacation_used || 0) + daysCount;
      if (leaveType === 'Maternity') updates.maternity_used = (balance.maternity_used || 0) + daysCount;
      if (leaveType === 'Paternity') updates.paternity_used = (balance.paternity_used || 0) + daysCount;
      if (leaveType === 'Bereavement') updates.bereavement_used = (balance.bereavement_used || 0) + daysCount;

      const { error: upError } = await supabaseAdmin
        .from('hr2_leave_balances')
        .update(updates)
        .eq('employee_id', employeeId);

      if (upError) throw upError;
    } else {
      // Create balance record if missing
      if (leaveType === 'Sick') updates.sick_used = daysCount;
      if (leaveType === 'Vacation') updates.vacation_used = daysCount;
      if (leaveType === 'Maternity') updates.maternity_used = daysCount;
      if (leaveType === 'Paternity') updates.paternity_used = daysCount;
      if (leaveType === 'Bereavement') updates.bereavement_used = daysCount;
      updates.employee_id = employeeId;
      const { error: insError } = await supabaseAdmin
        .from('hr2_leave_balances')
        .insert(updates);
      if (insError) throw insError;
    }

    return { success: true };
  } catch (error: any) {
    console.error('approveLeaveRequest error:', error.message);
    return { success: false, error: error.message };
  }
}

export async function rejectLeaveRequest(leaveId: string, reason?: string) {
  try {
    const { error } = await supabaseAdmin
      .from('hr2_leave_requests')
      .update({ status: 'Rejected' })
      .eq('id', leaveId);

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('rejectLeaveRequest error:', error.message);
    return { success: false, error: error.message };
  }
}
