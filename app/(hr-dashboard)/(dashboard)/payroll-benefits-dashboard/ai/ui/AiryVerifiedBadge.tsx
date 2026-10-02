'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Sparkles, ShieldCheck, ShieldAlert, ShieldX, Loader2,
    ChevronDown, RefreshCw, ThumbsUp, ThumbsDown, UserCheck,
} from 'lucide-react';

export type AiryVerdict = 'approve' | 'review' | 'reject';

export type AiryExtracted = {
    merchant?: string | null;
    date?: string | null;
    amount?: number | null;
    currency?: string | null;
    receipt_number?: string | null;
    vat_or_tin?: string | null;
    items?: Array<{ name: string; amount: number }> | null;
};

export type AiryVerifyState =
    | { status: 'idle' }
    | { status: 'running' }
    | {
        status: 'done';
        verdict: AiryVerdict;
        confidence: number;
        notes: string;
        mismatches: Array<{
            field: string;
            claimed: string;
            found: string;
            severity: 'low' | 'medium' | 'high';
        }>;
        tamperSignals: string[];
        provider: string;
        model: string;
        extracted?: AiryExtracted | null;
        receiptReadable?: boolean;
        readabilityIssue?: string | null;
        override?: boolean;
        overrideBy?: string | null;
        overrideReason?: string | null;
        overriddenAt?: string | null;
    }
    | { status: 'error'; error: string };

type Props = {
    state: AiryVerifyState;
    onRun?: () => void | Promise<void>;
    onOverride?: (verdict: AiryVerdict) => void;
    onView?: () => void;
};

const VERDICT_META: Record<AiryVerdict, { label: string; cls: string; Icon: any }> = {
    approve: {
        label: 'Airy Passed',
        cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-800/40',
        Icon: ShieldCheck,
    },
    review: {
        label: 'Airy: Review',
        cls: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-800/40',
        Icon: ShieldAlert,
    },
    reject: {
        label: 'Airy: Rejected',
        cls: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-800/40',
        Icon: ShieldX,
    },
};

function pct(n: number) {
    return `${Math.round(n * 100)}%`;
}

export default function AiryVerifiedBadge({ state, onRun, onOverride, onView }: Props) {
    const [open, setOpen] = useState(false);

    if (state.status === 'idle') {
        return (
            <button
                type="button"
                onClick={onRun}
                disabled={!onRun}
                className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/5 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/15 transition-colors font-rethink whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <Sparkles className="h-3 w-3" />
                Not yet verified
            </button>
        );
    }

    if (state.status === 'running') {
        return (
            <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/5 px-2 py-0.5 text-[10px] font-medium text-accent font-rethink whitespace-nowrap">
                <Loader2 className="h-3 w-3 animate-spin" />
                Airy is checking…
            </span>
        );
    }

    if (state.status === 'error') {
        return (
            <button
                type="button"
                onClick={onRun}
                className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-100 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-300 font-rethink whitespace-nowrap"
                title={state.error}
            >
                <RefreshCw className="h-3 w-3" />
                Retry Airy
            </button>
        );
    }

    const meta = VERDICT_META[state.verdict];
    const { Icon } = meta;
    const lowConfidence = state.confidence < 0.8;
    const overridden = state.override === true;

    return (
        <div className="relative inline-block">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition-all font-rethink whitespace-nowrap ${meta.cls} hover:brightness-95`}
            >
                <Icon className="h-3 w-3" />
                {overridden ? `Override · ${meta.label}` : meta.label}
                <span className="ml-0.5 font-mono opacity-70">{pct(state.confidence)}</span>
                {lowConfidence && <span className="ml-0.5 text-[9px] opacity-80">· low</span>}
                <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.98 }}
                        transition={{ duration: 0.12 }}
                        className="absolute z-30 right-0 mt-1.5 w-72 rounded-lg border border-line bg-paper p-3 shadow-xl dark:border-line/30 text-left"
                    >
                        <div className="mb-2 flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-accent" />
                            <p className="text-[11px] font-semibold text-ink font-rethink">
                                Airy receipt verification
                            </p>
                            <span className="ml-auto text-[9px] text-muted font-rethink">
                                {state.provider} · {state.model}
                            </span>
                        </div>

                        <div className="mb-2 flex items-center justify-between text-[10px] font-rethink">
                            <span className="text-muted">Confidence</span>
                            <div className="flex items-center gap-1.5">
                                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink/10">
                                    <div
                                        className={`h-full rounded-full ${state.verdict === 'approve'
                                                ? 'bg-emerald-500'
                                                : state.verdict === 'review'
                                                    ? 'bg-amber-500'
                                                    : 'bg-red-500'
                                            }`}
                                        style={{ width: pct(state.confidence) }}
                                    />
                                </div>
                                <span className="font-mono text-ink">{pct(state.confidence)}</span>
                            </div>
                        </div>

                        {overridden && (
                            <div className="mb-2 flex items-start gap-1.5 rounded border border-blue-200 bg-blue-50/60 px-2 py-1.5 text-[10px] text-blue-800 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-blue-200">
                                <UserCheck className="h-3 w-3 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-semibold">Overridden by HR</p>
                                    <p className="opacity-80">
                                        {state.overrideBy ? `${state.overrideBy}` : 'A reviewer'}
                                        {state.overriddenAt ? ` · ${state.overriddenAt}` : ''}
                                    </p>
                                    {state.overrideReason && (
                                        <p className="italic mt-0.5">"{state.overrideReason}"</p>
                                    )}
                                </div>
                            </div>
                        )}

                        {state.mismatches.length > 0 && (
                            <div className="mb-2">
                                <p className="mb-1 text-[10px] font-semibold text-ink font-rethink">Mismatches</p>
                                <ul className="space-y-1">
                                    {state.mismatches.map((m, i) => (
                                        <li
                                            key={i}
                                            className="rounded border border-amber-200/60 bg-amber-50/60 px-2 py-1 text-[10px] text-amber-800 dark:border-amber-800/30 dark:bg-amber-950/20 dark:text-amber-300"
                                        >
                                            <span className="font-medium">{m.field}</span>
                                            <span className="mx-1 opacity-60">·</span>
                                            <span className="opacity-80">{m.severity}</span>
                                            <div className="mt-0.5 opacity-80">
                                                claimed: <em>{m.claimed}</em> → found: <em>{m.found}</em>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {state.tamperSignals.length > 0 && (
                            <div className="mb-2">
                                <p className="mb-1 text-[10px] font-semibold text-red-600 font-rethink">Tamper signals</p>
                                <ul className="list-disc pl-4 text-[10px] text-red-700 dark:text-red-300">
                                    {state.tamperSignals.map((t, i) => (
                                        <li key={i}>{t}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {state.notes && (
                            <p className="mb-2 rounded bg-ink/[0.03] px-2 py-1.5 text-[10px] italic text-ink/80 font-rethink dark:bg-ink/[0.06] whitespace-pre-line">
                                {state.notes}
                            </p>
                        )}

                        <div className="flex gap-1.5 border-t border-line pt-2 dark:border-line/30">
                            {onView && (
                                <button
                                    type="button"
                                    onClick={() => { onView(); setOpen(false); }}
                                    className="flex flex-1 items-center justify-center gap-1 rounded-md border border-line bg-paper px-2 py-1 text-[10px] font-medium text-ink hover:bg-ink/[0.03] font-rethink dark:border-line/30"
                                >
                                    View details
                                </button>
                            )}
                            {onRun && !overridden && (
                                <button
                                    type="button"
                                    onClick={() => { onRun(); setOpen(false); }}
                                    className="flex flex-1 items-center justify-center gap-1 rounded-md border border-line bg-paper px-2 py-1 text-[10px] font-medium text-ink hover:bg-ink/[0.03] font-rethink dark:border-line/30"
                                >
                                    <RefreshCw className="h-3 w-3" /> Re-scan
                                </button>
                            )}
                        </div>

                        {onOverride && !overridden && (
                            <div className="mt-1.5 flex gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => { onOverride('approve'); setOpen(false); }}
                                    className="flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-700 font-rethink"
                                >
                                    <ThumbsUp className="h-3 w-3" /> Override
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { onOverride('reject'); setOpen(false); }}
                                    className="flex flex-1 items-center justify-center gap-1 rounded-md bg-red-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-700 font-rethink"
                                >
                                    <ThumbsDown className="h-3 w-3" /> Reject
                                </button>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}