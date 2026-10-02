import type { ApiResponse } from '../types/api';
import { MOCK_DB } from './mockDatabase';

/**
 * Thin wrapper around fetch for our JSON API. Throws on non-2xx or {error}.
 * Returns the unwrapped `data` payload.
 */
const WF_API_BASE = '/workforce-management-dashboard';

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  // SIMULATION MODE INTERCEPTION
  if (typeof window !== 'undefined' && localStorage.getItem('simulation_mode') === 'true') {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (url.includes('/api/shifts')) resolve(MOCK_DB.shifts as any);
        else if (url.includes('/api/leave/balances')) resolve(MOCK_DB.leaveBalances as any);
        else if (url.includes('/api/leave/requests')) resolve(MOCK_DB.leaveRequests as any);
        else if (url.includes('/api/employee_analytics')) resolve(MOCK_DB.analytics as any);
        else if (url.includes('/api/analytics')) resolve(MOCK_DB.dashboardAnalytics as any);
        else if (url.includes('/api/timesheets')) resolve(MOCK_DB.timesheets as any);
        else if (url.includes('/api/attendance/manual') && init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          const emp = MOCK_DB.employees.find(e => e.id === body.employee_id) || MOCK_DB.employees[0];
          
          if (!emp.rfid_uid) {
             reject(new Error('Employee must have an active registered RFID tag before manual bypass can be used.'));
             return;
          }
          
          if (body.action === 'Clock In') {
            const punchDate = new Date(body.punch_time);
            const status = punchDate.getHours() > 9 ? 'Tardy' : 'On-Shift';
            
            const newLog = {
              id: 'mock-manual-' + Date.now(),
              employee_id: emp.id,
              employee: emp,
              status: status,
              last_scan: body.punch_time,
              time_in: body.punch_time,
              shift_start: '09:00:00',
              shift_end: '18:00:00',
              terminal: 'HQ (Manual)',
              created_at: new Date().toISOString(),
              is_manual_override: true,
              manual_override_reason: body.manual_override_reason,
              manual_override_notes: body.manual_override_notes,
            };
            MOCK_DB.attendance.unshift(newLog as any);
          } else {
            const existing = MOCK_DB.attendance.find(a => a.employee_id === emp.id && a.status !== 'Clocked Out');
            if (existing) {
              existing.status = 'Clocked Out';
              existing.time_out = body.punch_time;
              existing.last_scan = body.punch_time;
              (existing as any).is_manual_override = true;
              (existing as any).manual_override_reason = body.manual_override_reason;
              (existing as any).manual_override_notes = body.manual_override_notes;
              
              // Dynamically recalculate the timesheet for this employee based on the new clock out
              const ts = MOCK_DB.timesheets.find((t: any) => t.employee_id === emp.id);
              if (ts) {
                const allLogs = MOCK_DB.attendance.filter(a => a.employee_id === emp.id && a.time_in && a.time_out);
                let totalH = 0;
                allLogs.forEach(log => {
                  const diff = (new Date(log.time_out!).getTime() - new Date(log.time_in!).getTime()) / (1000 * 60 * 60) - 1; // -1 hr break
                  totalH += Math.max(0, diff);
                });
                (ts as any).total_hours = parseFloat(totalH.toFixed(2));
                (ts as any).overtime_hours = parseFloat(Math.max(0, totalH - 40).toFixed(2));
                if (totalH > 45) (ts as any).status = 'Flagged Overtime';
              }
            }
          }
          resolve({ data: { success: true } } as any);
        }
        else if (url.includes('/api/attendance')) resolve(MOCK_DB.attendance as any);
        else if (url.includes('/api/drivers') || url.includes('/api/employees') || url.includes('/api/profiles')) resolve(MOCK_DB.employees as any);
        else resolve([] as any);
      }, 400); // Simulate network delay
    });
  }

  // Prefix /api/... calls with the workforce module route so they hit the
  // App Router route handlers at workforce-management-dashboard/api/*/route.ts
  const resolvedUrl = url.startsWith('/api/') ? `${WF_API_BASE}${url}` : url;
  const res = await fetch(resolvedUrl, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!res.ok || 'error' in body) {
    throw new Error('error' in body ? body.error : `Request failed (${res.status})`);
  }
  return body.data;
}
