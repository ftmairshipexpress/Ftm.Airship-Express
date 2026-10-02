'use client';

import React, { useState, useEffect } from 'react';
import { Users, Activity, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { CardShiftSnapshot } from '../components/analytics/CardShiftSnapshot';
import { Card4RealtimeAttendance } from '../components/analytics/Card4RealtimeAttendance';
import { useRealtimeAttendance } from '../hooks/useRealtime';
import { apiFetch } from '../lib/apiFetch';
import {
  computeMomGrowthPct,
  computeOnShiftUtilization,
} from '../lib/analytics';
import type { WorkforceForecast } from '../types/workforce';

interface AnalyticsData {
  forecast: WorkforceForecast[];
  workforce: number;
}

export default function DashboardPage() {
  const { attendance, connected } = useRealtimeAttendance();
  const [data, setData] = useState<AnalyticsData>({
    forecast: [],
    workforce: 0,
  });
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AnalyticsData>('/api/analytics')
      .then(setData)
      .catch((err) => setLoadError(err.message));
  }, []);

  const totalWorkforce = data.workforce || attendance.length;
  const growthPct = computeMomGrowthPct(data.forecast);
  const onShift = attendance.filter((a) => a.status === 'On-Shift').length;

  return (
    <>
      {/* Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-paper p-5 rounded-2xl border border-line shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-ink flex items-center gap-2">
            Dashboard
            <span className="text-xs bg-accent/10 text-accent px-2.5 py-0.5 rounded-full font-medium border border-accent/20">
              Primary Admin Control
            </span>
          </h1>
          <p className="text-xs text-muted mt-1">
            Integrated real-time workforce intelligence for driver retention and attendance tracking.
          </p>
        </div>
      </div>

      {loadError && (
        <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl text-xs text-rose-600 dark:text-rose-400">
          Could not load analytics data: {loadError}. Ensure your Supabase tables are seeded.
        </div>
      )}

      {/* Quick metrics strip */}
      <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
        <MetricTile
          label="Total Active Workforce"
          value={String(totalWorkforce)}
          icon={<Users size={16} />}
          footer={
            growthPct === null ? (
              <span className="text-muted">Headcount across all terminals</span>
            ) : (
              <span
                className={`font-semibold flex items-center gap-1 ${
                  growthPct >= 0 ? 'text-emerald-500' : 'text-rose-500'
                }`}
              >
                {growthPct >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{' '}
                {Math.abs(growthPct).toFixed(1)}% from last month
              </span>
            )
          }
        />
        <MetricTile
          label="Workforce Deployed"
          value={`${onShift}`}
          icon={<Activity size={16} />}
          footer={<span className="text-muted">{onShift} of {totalWorkforce} active right now</span>}
        />
      </div>

      {/* 2-card grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CardShiftSnapshot />
        <Card4RealtimeAttendance attendance={attendance} connected={connected} />
      </div>
    </>
  );
}

function MetricTile({
  label,
  value,
  icon,
  footer,
  danger = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  footer: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="bg-paper p-4 rounded-2xl border border-line shadow-2xs hover:border-accent/30 transition">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        <div className={`p-2 rounded-xl ${danger ? 'bg-rose-500/10 text-rose-500' : 'bg-accent/10 text-accent'}`}>
          {icon}
        </div>
      </div>
      <p className={`text-2xl font-bold mt-2 ${danger ? 'text-rose-500' : 'text-ink'}`}>
        {value}
      </p>
      <p className="text-[11px] mt-1">{footer}</p>
    </div>
  );
}
