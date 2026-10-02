"use client";

import { StatusBadge } from "../../../../../components/ui/StatusBadge";

interface ScanSummaryProps {
    lastScan: string;
    trackingNumber?: string;
    lastScanStatus?: string;
}

export function ScanSummary({ lastScan, trackingNumber, lastScanStatus }: ScanSummaryProps) {
    const getStatusTone = (status?: string) => {
        if (!status) return 'neutral' as const;
        switch (status) {
            case 'verified':
            case 'received':
                return 'emerald' as const;
            case 'rejected':
                return 'rose' as const;
            case 'not_synced':
                return 'rose' as const;
            default:
                return 'amber' as const;
        }
    };

    const getStatusIcon = (status?: string) => {
        if (!status) return 'fa-circle';
        switch (status) {
            case 'verified':
            case 'received':
                return 'fa-check-circle';
            case 'rejected':
                return 'fa-times-circle';
            case 'not_synced':
                return 'fa-satellite-dish';
            default:
                return 'fa-clock';
        }
    };

    return (
        <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-white/[0.06] text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2 sm:gap-4 font-medium">
            <span className="flex items-center gap-2 flex-wrap">
                <span>Last scan:</span>
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100 bg-[#ebf0f7] dark:bg-[#12131d] px-2.5 py-0.5 rounded-lg border border-white/80 dark:border-white/[0.06] shadow-[inset_1px_1px_2px_rgba(166,175,195,0.25)]">
                    {lastScan}
                </span>
                {trackingNumber && (
                    <span className="text-slate-400 dark:text-slate-500 text-[11px]">
                        (TRK: <span className="font-mono text-slate-600 dark:text-slate-300 font-semibold">{trackingNumber}</span>)
                    </span>
                )}
                {lastScanStatus && (
                    <span className="inline-flex align-middle">
                        <StatusBadge
                            tone={getStatusTone(lastScanStatus)}
                            icon={`fas ${getStatusIcon(lastScanStatus)}`}
                            size="xs"
                        >
                            {lastScanStatus === 'not_synced' ? 'Not Synced' : lastScanStatus}
                        </StatusBadge>
                    </span>
                )}
            </span>
        </div>
    );
}