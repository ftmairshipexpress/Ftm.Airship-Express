'use server';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function getSystemSettings() {
  try {
    const { data, error } = await supabaseAdmin.from('hr2_system_settings').select('*');
    if (error) throw error;
    
    const settings: Record<string, string> = {};
    data.forEach(item => { settings[item.setting_key] = item.setting_value; });
    
    return { success: true, settings };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function saveSystemSettings(settings: Record<string, string>) {
  try {
    for (const [key, value] of Object.entries(settings)) {
      await supabaseAdmin.from('hr2_system_settings').upsert({
        setting_key: key,
        setting_value: value,
      }, { onConflict: 'setting_key' });
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
