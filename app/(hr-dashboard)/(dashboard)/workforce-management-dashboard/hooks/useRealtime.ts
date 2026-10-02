import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/apiFetch';
import { supabase } from '../../../supabase/client';
import type { AttendanceLog } from '../types/workforce';
const POLL_MS = 10000;

interface UseRealtimeAttendanceResult {
  attendance: AttendanceLog[];
  loading: boolean;
  error: string | null;
  connected: boolean;
  refetch: () => Promise<void>;
}

/**
 * Loads the attendance feed through the /api/attendance route and polls it so
 * the UI stays fresh without requiring a signed-in Supabase session (RLS would
 * otherwise block the anonymous browser client). `connected` becomes true once
 * the first poll succeeds.
 */
export function useRealtimeAttendance(): UseRealtimeAttendanceResult {
  const [attendance, setAttendance] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const fetchAttendance = useCallback(async () => {
    try {
      const data = await apiFetch<AttendanceLog[]>('/api/attendance');
      setAttendance(data);
      setError(null);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 1. Initial Fetch
    fetchAttendance();

    // 2. Setup Realtime Subscription
    const channel = supabase
      .channel('attendance-logs-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hr2_attendance_logs' },
        (payload) => {
          console.log('Realtime Attendance payload received!', payload);
          // Since the payload only has raw DB rows without the joined 'employee' data, 
          // we just trigger a lightweight refetch to grab the full mapped data instantly.
          fetchAttendance();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Successfully connected to Supabase Realtime!');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAttendance]);

  return { attendance, loading, error, connected, refetch: fetchAttendance };
}
