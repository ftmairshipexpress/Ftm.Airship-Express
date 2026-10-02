'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Sparkles, RefreshCw, Check, TrendingUp, ShieldCheck,
    ShieldQuestion, ShieldAlert, Loader2,
} from 'lucide-react';

import { AiryAvatar } from './Avatar';
import { Button } from '@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/components/ui/Button';

import {
    suggestMerit,
    type MeritSuggestionInput,
    type MeritSuggestionResult,
} from '@/app/(hr-dashboard)/(dashboard)/payroll-benefits-dashboard/ai/actions/suggestMerit';

type Props = {
    isOpen: boolean;
    onClose: () => void;
    onApply: (r: MeritSuggestionResult) => void;
    input: MeritSuggestionInput | null;
};

const CONFIDENCE_STYLE: Record<
    MeritSuggestionResult['confidence'],
    { label: string; cls: string; Icon: any }
> = {
    high: {
        label: 'High confidence',
        cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-800/40',
        Icon: ShieldCheck,
    },
    medium: {
        label: 'Medium confidence',
        cls: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-800/40',
        Icon: ShieldQuestion,
    },
    low: {
        label: 'Low confidence',
        cls: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-800/40',
        Icon: ShieldAlert,
    },
};

const RETENTION_STYLE: Record<
    MeritSuggestionResult['retention_risk'],
    { label: string; cls: string }
> = {
    high: {
        label: 'High retention risk',
        cls: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-800/40',
    },
    medium: {
        label: 'Medium retention risk',
        cls: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-800/40',
    },
    low: {
        label: 'Low retention risk',
        cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-800/40',
    },
};

const IMPACT_ICON: Record<
    MeritSuggestionResult['factors'][number]['impact'],
    React.ReactNode
> = {
    positive: <TrendingUp className="h-3 w-3 text-emerald-600" />,
    negative: <TrendingUp className="h-3 w-3 rotate-180 text-red-600" />,
    neutral: <span className="block h-1.5 w-1.5 rounded-full bg-ink/30" />,
};

const STAGES = [
    'Reading HR3 appraisal…',
    'Weighing strengths & improvements…',
    'Comparing against merit policy…',
    'Estimating retention risk…',
    'Drafting recommendation…',
];

export default function AiryMeritSuggestion({
    isOpen,
    onClose,
    onApply,
    input,
}: Props) {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<MeritSuggestionResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [stage, setStage] = useState(0);

    const run = useCallback(() => {
        if (!input) return;
        setResult(null);
        setError(null);
        setStage(0);
        setLoading(true);
        suggestMerit(input)
            .then(setResult)
            .catch((e) => setError(e?.message ?? 'Airy is unavailable'))
            .finally(() => setLoading(false));
    }, [input]);

    useEffect(() => {
        if (!isOpen) return;
        run();
    }, [isOpen, run]);

    useEffect(() => {
        if (!loading) return;
        const t = setInterval(
            () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
            700
        );
        return () => clearInterval(t);
    }, [loading]);

    if (!isOpen) return null;

    const conf = result ? CONFIDENCE_STYLE[result.confidence] : null;
    const ret = result ? RETENTION_STYLE[result.retention_risk] : null;
    const ConfIcon = conf?.Icon;

    return (
        <div className="fixed inset-0 z-[110] flex items-end justify-end p-3 sm:p-6">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
                onClick={loading ? undefined : onClose}
            />

            <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 24, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl dark:border-line/30"
            >
                <div className="relative overflow-hidden border-b border-line bg-gradient-to-br from-accent/5 via-pink-50/50 to-purple-50/50 px-4 py-3 dark:border-line/30 dark:from-accent/10 dark:via-pink-950/10 dark:to-purple-950/10">
                    <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-accent/10 blur-2xl" />
                    <div className="relative flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-purple-500 shadow-lg shadow-accent/30">
                            <Sparkles className="h-4 w-4 text-white" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-ink font-rethink truncate">
                                Airy · Merit Suggestion
                            </p>
                            <p className="text-[10px] text-muted font-rethink truncate">
                                {input?.employee_name ?? 'Employee'}
                            </p>
                        </div>
                        {!loading && (
                            <button
                                type="button"
                                onClick={run}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-ink/5 hover:text-ink"
                                aria-label="Re-run"
                                title="Re-run"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={loading ? undefined : onClose}
                            disabled={loading}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label="Close"
                        >
                            <span className="text-lg leading-none">×</span>
                        </button>
                    </div>
                </div>

                <div className="max-h-[70vh] overflow-y-auto p-4 space-y-4">
                    <div className="flex items-center gap-3">
                        <AiryAvatar
                            status={loading ? 'thinking' : 'idle'}
                            size="lg"
                            video={loading}
                            showRing
                        />
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-ink font-rethink">
                                Airy
                            </p>
                            <p className="text-[11px] text-muted font-rethink truncate">
                                {loading
                                    ? STAGES[stage]
                                    : error
                                        ? 'Something went wrong'
                                        : 'Analysis complete'}
                            </p>
                        </div>
                    </div>

                    <AnimatePresence mode="wait">
                        {loading && (
                            <motion.div
                                key="loading"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="flex items-center gap-2 text-xs text-muted font-rethink"
                            >
                                <Loader2 className="h-4 w-4 animate-spin text-pink-500" />
                                {STAGES[stage]}
                            </motion.div>
                        )}

                        {error && !loading && (
                            <motion.div
                                key="error"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="space-y-3"
                            >
                                <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 text-xs text-red-700 font-rethink dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-300">
                                    {error}
                                </div>
                                <Button type="button" onClick={run} className="font-rethink">
                                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                    Try again
                                </Button>
                            </motion.div>
                        )}

                        {result && !loading && (
                            <motion.div
                                key="result"
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="space-y-3"
                            >
                                <div className="grid grid-cols-3 gap-2 text-center">
                                    <div className="rounded-lg bg-ink/[0.03] p-2 dark:bg-ink/[0.06]">
                                        <p className="text-[9px] uppercase tracking-wide text-muted font-rethink">
                                            Baseline
                                        </p>
                                        <p className="font-mono text-sm font-semibold text-ink">
                                            {result.policy_baseline_percent}%
                                        </p>
                                    </div>
                                    <div className="rounded-lg bg-pink-50 p-2 dark:bg-pink-950/30">
                                        <p className="text-[9px] uppercase tracking-wide text-pink-600 font-rethink">
                                            Airy suggests
                                        </p>
                                        <p className="font-mono text-sm font-semibold text-pink-600">
                                            {result.recommended_increase_percent}%
                                        </p>
                                    </div>
                                    <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/30">
                                        <p className="text-[9px] uppercase tracking-wide text-emerald-600 font-rethink">
                                            New salary
                                        </p>
                                        <p className="font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                                            ₱{result.recommended_new_salary.toLocaleString()}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    {conf && ConfIcon && (
                                        <span
                                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${conf.cls}`}
                                        >
                                            <ConfIcon className="h-3 w-3" />
                                            {conf.label}
                                        </span>
                                    )}
                                    {ret && (
                                        <span
                                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${ret.cls}`}
                                        >
                                            {ret.label}
                                        </span>
                                    )}
                                </div>

                                {result.factors?.length > 0 && (
                                    <div className="rounded-lg border border-line bg-paper p-3 dark:border-line/30">
                                        <p className="mb-2 text-[10px] uppercase tracking-wide text-muted font-rethink">
                                            Contributing factors
                                        </p>
                                        <div className="space-y-1.5">
                                            {result.factors.map((f, i) => (
                                                <div key={i} className="flex items-center gap-2">
                                                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ink/[0.04] dark:bg-ink/[0.08]">
                                                        {IMPACT_ICON[f.impact]}
                                                    </div>
                                                    <span className="flex-1 truncate text-[11px] font-rethink text-ink">
                                                        {f.factor}
                                                    </span>
                                                    <div className="flex w-20 items-center gap-1.5">
                                                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/[0.06] dark:bg-ink/[0.12]">
                                                            <div
                                                                className="h-full rounded-full bg-accent"
                                                                style={{ width: `${f.weight}%` }}
                                                            />
                                                        </div>
                                                        <span className="w-8 text-right text-[10px] font-mono text-muted">
                                                            {Math.round(f.weight)}%
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {result.adjustment_reason && (
                                    <div className="rounded-lg border border-line bg-paper p-3 dark:border-line/30">
                                        <p className="mb-1 text-[10px] uppercase tracking-wide text-muted font-rethink">
                                            Adjustment vs. baseline
                                        </p>
                                        <p className="text-[12px] text-ink font-rethink leading-relaxed">
                                            {result.adjustment_reason}
                                        </p>
                                    </div>
                                )}

                                <div className="rounded-lg border border-line bg-paper p-3 dark:border-line/30">
                                    <p className="mb-1 text-[10px] uppercase tracking-wide text-muted font-rethink">
                                        Rationale
                                    </p>
                                    <p className="text-[12px] text-ink font-rethink leading-relaxed">
                                        {result.rationale}
                                    </p>
                                </div>

                                <div className="flex items-center justify-end gap-2 pt-1">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={onClose}
                                        className="font-rethink"
                                    >
                                        Dismiss
                                    </Button>
                                    <Button
                                        type="button"
                                        onClick={() => onApply(result)}
                                        className="font-rethink"
                                    >
                                        <Check className="mr-1.5 h-3.5 w-3.5" />
                                        Apply suggestion
                                    </Button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    );
}