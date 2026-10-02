'use client';

import React from 'react';
import { BlockedDevice, Appeal, UserActivity } from '../../types';
import { StatusBadge } from '../../../../components/ui/StatusBadge';
import { RefreshCw } from 'lucide-react';

interface HeaderStatsProps {
    blockedDevices: BlockedDevice[];
    appeals: Appeal[];
    activities: UserActivity[];
    isRealtimeActive?: boolean;
    isRefreshing?: boolean;
    onRefresh?: () => void;
}

export const HeaderStats: React.FC<HeaderStatsProps> = ({
    blockedDevices,
    appeals,
    activities,
    isRealtimeActive = true,
    isRefreshing = false,
    onRefresh,
}) => {
    const blockedCount = blockedDevices.filter(d => d.status === 'blocked').length;
    const pendingAppealsCount = appeals.filter(a => a.status === 'pending').length;

    return (
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-5">
            <div className="flex items-start gap-4 min-w-0">
                {/* Main Icon Box */}
                <div className="w-12 h-12 rounded-2xl bg-[#ffe6f0] border border-pink-300/90 dark:bg-[#341427] dark:border-[#67224c] flex items-center justify-center text-pink-600 dark:text-pink-300 text-xl shadow-[inset_0_1px_0_#ffffff,0_2px_6px_rgba(244,63,94,0.14)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_2px_6px_rgba(0,0,0,0.6)] shrink-0 mt-0.5">
                    <i className="fa-solid fa-laptop-code" />
                </div>

                {/* Text Content & Stat Badges */}
                <div className="min-w-0">
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                        Device Management
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        Monitor all sessions, manage blocked devices, view appeals, and user activity in realtime
                    </p>

                    {/* Quick Stats / Indicators */}
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                        {/* Blocked Devices Badge */}
                        {blockedCount > 0 && (
                            <StatusBadge tone="rose" dot size="xs">
                                <strong>{blockedCount}</strong> blocked device(s)
                            </StatusBadge>
                        )}

                        {/* Pending Appeals Badge */}
                        {pendingAppealsCount > 0 && (
                            <StatusBadge tone="amber" dot size="xs">
                                <strong>{pendingAppealsCount}</strong> pending appeal(s)
                            </StatusBadge>
                        )}

                        {/* Total Activities Badge */}
                        <StatusBadge tone="pink" icon={<i className="fas fa-chart-line text-[10px]" />} size="xs">
                            <strong>{activities.length}</strong> total activities
                        </StatusBadge>

                        {/* Realtime Live Indicator Badge */}
                        <div
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border shadow-xs select-none transition-colors ${
                                isRealtimeActive
                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200/70 dark:border-emerald-800/40'
                                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200/70 dark:border-amber-800/40'
                            }`}
                        >
                            <span className="relative flex h-2 w-2">
                                <span
                                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                                        isRealtimeActive ? 'bg-emerald-400' : 'bg-amber-400'
                                    }`}
                                ></span>
                                <span
                                    className={`relative inline-flex rounded-full h-2 w-2 ${
                                        isRealtimeActive ? 'bg-emerald-500' : 'bg-amber-500'
                                    }`}
                                ></span>
                            </span>
                            <span>{isRealtimeActive ? 'Live Realtime' : 'Connecting...'}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick manual refresh button */}
            {onRefresh && (
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    title="Refresh all tabs"
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 bg-[#f0f3f8] dark:bg-[#1e1f2c] hover:bg-[#e4ebf5] dark:hover:bg-[#282a3a] border border-white/90 dark:border-white/[0.08] shadow-[3px_3px_6px_rgba(166,175,195,0.35),-3px_-3px_6px_rgba(255,255,255,0.95)] dark:shadow-[3px_3px_7px_rgba(0,0,0,0.5)] rounded-xl transition-all cursor-pointer active:scale-95 disabled:opacity-50 shrink-0"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-pink-500' : 'text-slate-500 dark:text-slate-400'}`} />
                    <span>{isRefreshing ? 'Syncing...' : 'Sync Now'}</span>
                </button>
            )}
        </div>
    );
};
