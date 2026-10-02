'use client';

import React, { useEffect, useState } from 'react';
import { CalendarCheck, Clock, ArrowRight } from 'lucide-react';
import { Card, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { apiFetch } from '../../lib/apiFetch';
import type { Shift } from '../../types/workforce';
import Link from 'next/link';


function shiftStatusClass(status: string) {
  if (status === 'On-Shift') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
  if (status === 'Completed') return 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20';
  if (status === 'Cancelled') return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
  return 'bg-ink/[0.06] text-muted border-line'; // Scheduled / default
}

export function CardShiftSnapshot() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Shift[]>('/api/shifts')
      .then((data) => setShifts(data || []))
      .catch(() => setShifts([]))
      .finally(() => setLoading(false));
  }, []);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const dayIndex = today.getDay(); // 0=Su, 1=M, ...
  const dayCodes = ['Su', 'M', 'Tu', 'We', 'Th', 'F', 'Sa'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayCode = dayCodes[dayIndex];
  const todayName = dayNames[dayIndex];

  const todayShifts = shifts.filter((s) => {
    if (s.is_recurring) {
      if (s.shift_date > todayStr) return false;
      const days = s.recurring_days || [];
      return days.includes(todayCode) || days.includes(todayName);
    }
    return s.shift_date === todayStr;
  });
  const scheduledCount = todayShifts.length;
  const onShiftCount = todayShifts.filter((s) => s.status === 'In Progress' || s.status === 'Completed').length;

  return (
    <Card className="p-5 space-y-4">
      <CardHeader
        title="Today's Shift Snapshot"
        subtitle={`${scheduledCount} assignment${scheduledCount !== 1 ? 's' : ''} scheduled for today`}
        action={
          <Link
            href="/hr-dashboard/dashboard/workforce-management-dashboard/shifts"
            className="text-xs text-accent hover:underline flex items-center gap-1"
          >
            View all <ArrowRight size={11} />
          </Link>
        }
      />

      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-accent/10 border border-accent/20 p-3 rounded-xl text-center">
          <p className="text-[10px] text-accent font-semibold uppercase tracking-wide">Scheduled</p>
          <p className="text-2xl font-bold text-accent">{loading ? '—' : scheduledCount}</p>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl text-center">
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wide">Dispatched</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{loading ? '—' : onShiftCount}</p>
        </div>
      </div>

      {/* Shift list */}
      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
        {loading && (
          <div className="space-y-2">
            {[1,2,3].map(i => (
              <div key={i} className="h-10 bg-ink/5 rounded-xl animate-pulse" />
            ))}
          </div>
        )}
        {!loading && todayShifts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <CalendarCheck size={24} className="text-muted/40" />
            <p className="text-xs text-muted">No shifts scheduled for today.</p>
          </div>
        )}
        {todayShifts.map((shift) => (
          <div
            key={shift.id}
            className="flex items-center justify-between p-2.5 bg-ink/[0.02] dark:bg-paper/[0.04] rounded-xl border border-line"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-accent/10 text-accent font-bold text-xs flex items-center justify-center shrink-0">
                {shift.employee?.avatar_initials || '?'}
              </div>
              <div>
                <p className="text-xs font-semibold text-ink truncate max-w-[120px]">
                  {shift.employee?.full_name || shift.title || 'Unassigned'}
                </p>
                <p className="text-[10px] text-muted flex items-center gap-1">
                  <Clock size={9} />
                  {shift.shift_time || 'N/A'}
                </p>
              </div>
            </div>
            <Badge className={shiftStatusClass(shift.status)}>
              {shift.status}
            </Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}
