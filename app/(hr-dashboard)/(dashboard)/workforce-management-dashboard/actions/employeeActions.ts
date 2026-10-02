'use server';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function reactivateRfidCard(employeeId: string) {
  try {
    const { error } = await supabaseAdmin
      .from('hr2_rfid_bind')
      .update({ card_status: 'Active' })
      .eq('employee_id', employeeId);

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function revertEmployeeAwol(employeeId: string) {
  try {
    const { error } = await supabaseAdmin
      .from('hr1_employees')
      .update({ status: 'Active' })
      .eq('id', employeeId);

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
