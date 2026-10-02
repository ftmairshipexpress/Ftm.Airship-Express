'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Session } from '../../types';
import { DEFAULT_ALLOWED_DAYS, DEFAULT_TIME_START, DEFAULT_TIME_END } from '../../../../lib/services/userAccessService';
import { useConfirm } from '../../../../components/ui/ConfirmModal';
import Portal from '../../../../components/client/Portal';

interface EditAccessScheduleModalProps {
    isOpen: boolean;
    session?: Session | null;
    bulkSessions?: Session[];
    onClose: () => void;
    onSave: (rule: {
        email: string;
        user_id?: string;
        display_name?: string;
        role?: string;
        is_allow: boolean;
        allowed_days: string[];
        allowed_time_start: string;
        allowed_time_end: string;
        auth_requested?: boolean;
    }) => Promise<void>;
    onSaveBulk?: (rules: Array<{
        email: string;
        user_id?: string;
        display_name?: string;
        role?: string;
        is_allow: boolean;
        allowed_days: string[];
        allowed_time_start: string;
        allowed_time_end: string;
        auth_requested?: boolean;
    }>) => Promise<void>;
}

const ALL_DAYS = [
    { key: 'Monday', label: 'Mon', full: 'Monday' },
    { key: 'Tuesday', label: 'Tue', full: 'Tuesday' },
    { key: 'Wednesday', label: 'Wed', full: 'Wednesday' },
    { key: 'Thursday', label: 'Thu', full: 'Thursday' },
    { key: 'Friday', label: 'Fri', full: 'Friday' },
    { key: 'Saturday', label: 'Sat', full: 'Saturday' },
    { key: 'Sunday', label: 'Sun', full: 'Sunday' },
];

export const EditAccessScheduleModal: React.FC<EditAccessScheduleModalProps> = ({
    isOpen,
    session,
    bulkSessions,
    onClose,
    onSave,
    onSaveBulk,
}) => {
    const { confirm } = useConfirm();
    const [isAllow, setIsAllow] = useState(true);
    const [allowedDays, setAllowedDays] = useState<string[]>(DEFAULT_ALLOWED_DAYS);
    const [timeStart, setTimeStart] = useState(DEFAULT_TIME_START);
    const [timeEnd, setTimeEnd] = useState(DEFAULT_TIME_END);
    const [isSaving, setIsSaving] = useState(false);

    const isBulkMode = Array.isArray(bulkSessions) && bulkSessions.length > 0;

    useEffect(() => {
        if (session && !isBulkMode) {
            setIsAllow(Boolean(session.is_allow));
            setAllowedDays(session.allowed_days && session.allowed_days.length > 0 ? session.allowed_days : DEFAULT_ALLOWED_DAYS);
            setTimeStart(session.allowed_time_start || DEFAULT_TIME_START);
            setTimeEnd(session.allowed_time_end || DEFAULT_TIME_END);
        } else if (isBulkMode) {
            setIsAllow(true);
            setAllowedDays(DEFAULT_ALLOWED_DAYS);
            setTimeStart(DEFAULT_TIME_START);
            setTimeEnd(DEFAULT_TIME_END);
        }
    }, [session, bulkSessions, isBulkMode]);

    if (!isOpen || (!session && !isBulkMode)) return null;

    const email = session?.email || session?.users?.email || '';
    const displayName = session?.users?.display_name || session?.hr_employee_name || email || 'User';
    const role = session?.users?.role || 'Employee';

    const toggleDay = (day: string) => {
        setAllowedDays(prev => 
            prev.includes(day) 
                ? (prev.length > 1 ? prev.filter(d => d !== day) : prev) 
                : [...prev, day]
        );
    };

    const setPresetDays = (preset: 'workdays' | 'all' | 'weekends') => {
        if (preset === 'workdays') setAllowedDays(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
        else if (preset === 'all') setAllowedDays(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
        else if (preset === 'weekends') setAllowedDays(['Saturday', 'Sunday']);
    };

    const setPresetTime = (start: string, end: string) => {
        setTimeStart(start);
        setTimeEnd(end);
    };

    const handleFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (isBulkMode && bulkSessions) {
            if (!isAllow) {
                const confirmed = await confirm({
                    title: `Bulk Disable ${bulkSessions.length} Accounts`,
                    message: `Are you sure you want to disable login access for all ${bulkSessions.length} selected users? Active sessions will be terminated immediately.`,
                    confirmText: 'Disable Access',
                    cancelText: 'Cancel',
                    confirmVariant: 'danger',
                });
                if (!confirmed) return;
            }

            setIsSaving(true);
            try {
                const rulesToUpdate = bulkSessions.map(s => ({
                    email: s.email || s.users?.email || '',
                    user_id: s.user_id,
                    display_name: s.users?.display_name || s.hr_employee_name,
                    role: s.users?.role,
                    is_allow: isAllow,
                    allowed_days: allowedDays,
                    allowed_time_start: timeStart,
                    allowed_time_end: timeEnd,
                    auth_requested: false,
                })).filter(r => Boolean(r.email));

                if (onSaveBulk) {
                    await onSaveBulk(rulesToUpdate);
                } else {
                    for (const r of rulesToUpdate) {
                        await onSave(r);
                    }
                }
                onClose();
            } finally {
                setIsSaving(false);
            }
            return;
        }

        // Single session update
        if (session && Boolean(session.is_allow) && !isAllow) {
            const confirmed = await confirm({
                title: 'Disable Login Access',
                message: `Are you sure you want to disable login access for ${displayName} (${email})? If this user has an active session, they will be logged out immediately.`,
                confirmText: 'Disable Access',
                cancelText: 'Cancel',
                confirmVariant: 'danger',
            });
            if (!confirmed) return;
        }

        setIsSaving(true);
        try {
            await onSave({
                email,
                user_id: session?.user_id,
                display_name: displayName,
                role,
                is_allow: isAllow,
                allowed_days: allowedDays,
                allowed_time_start: timeStart,
                allowed_time_end: timeEnd,
                auth_requested: false,
            });
            onClose();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Portal>
            <AnimatePresence>
                <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-md"
                        onClick={onClose}
                    />

                    {/* Modal Card */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ duration: 0.2 }}
                        className="relative z-10 w-full max-w-lg bg-[#f0f3f8] dark:bg-[#191a24] border border-white/80 dark:border-[#2c2d3c] rounded-3xl shadow-[12px_12px_36px_rgba(166,175,195,0.5),-12px_-12px_36px_rgba(255,255,255,0.95),inset_0_1px_1.5px_rgba(255,255,255,0.9)] dark:shadow-[14px_14px_40px_rgba(0,0,0,0.85),-8px_-8px_24px_rgba(255,255,255,0.03),inset_0_1px_1px_rgba(255,255,255,0.07)] overflow-hidden"
                    >
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-slate-200/60 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-pink-600 border border-pink-400/80 flex items-center justify-center text-white shadow-[3px_3px_7px_rgba(219,39,119,0.35),inset_0_1px_1.5px_rgba(255,255,255,0.4)]">
                                    <i className="fas fa-user-shield text-base" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                                        {isBulkMode ? `Bulk Schedule (${bulkSessions?.length} Users)` : 'Login Access & Schedule'}
                                    </h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {isBulkMode ? 'Configure schedule for all selected accounts' : 'Configure authorization and allowed working hours'}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="w-8 h-8 rounded-full bg-[#f0f3f8] dark:bg-[#14151c] hover:bg-[#e4ebf5] dark:hover:bg-[#232533] text-slate-600 dark:text-slate-300 border border-white/80 dark:border-slate-700/70 shadow-[2px_2px_5px_rgba(166,175,195,0.3),-2px_-2px_5px_rgba(255,255,255,0.9)] dark:shadow-[2px_2px_5px_rgba(0,0,0,0.5)] flex items-center justify-center transition-all cursor-pointer active:scale-95"
                            >
                                <i className="fas fa-times text-xs" />
                            </button>
                        </div>

                        <form onSubmit={handleFormSubmit} className="p-6 space-y-5">
                            {/* Summary Card */}
                            {isBulkMode ? (
                                <div className="p-3.5 rounded-2xl bg-[#ebf0f7] dark:bg-[#14151c] border border-slate-200/60 dark:border-slate-800 shadow-[inset_1.5px_1.5px_4px_rgba(166,175,195,0.3),inset_-1.5px_-1.5px_4px_rgba(255,255,255,0.85)] dark:shadow-[inset_1.5px_1.5px_4px_rgba(0,0,0,0.65)]">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                                            {bulkSessions?.length} Users Selected
                                        </h4>
                                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-pink-100 dark:bg-pink-950/80 text-pink-700 dark:text-pink-300">
                                            Bulk Update
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto custom-scrollbar">
                                        {bulkSessions?.map(s => (
                                             <span
                                                key={s.id || s.email}
                                                className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-white/70 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-white/50 dark:border-slate-700"
                                            >
                                                {s.users?.display_name || s.hr_employee_name || s.email}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="p-3.5 rounded-2xl bg-[#ebf0f7] dark:bg-[#14151c] border border-slate-200/60 dark:border-slate-800 shadow-[inset_1.5px_1.5px_4px_rgba(166,175,195,0.3),inset_-1.5px_-1.5px_4px_rgba(255,255,255,0.85)] dark:shadow-[inset_1.5px_1.5px_4px_rgba(0,0,0,0.65)] flex items-center justify-between">
                                    <div className="min-w-0">
                                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                                            {displayName}
                                        </h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                            {email}
                                        </p>
                                    </div>
                                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-pink-100 dark:bg-pink-950/80 text-pink-700 dark:text-pink-300 border border-pink-200 dark:border-pink-900/60 shrink-0">
                                        {role}
                                    </span>
                                </div>
                            )}

                            {/* Authorization Request Indicator Banner */}
                            {!isBulkMode && session?.auth_requested && (
                                <div className="p-3 rounded-2xl bg-sky-500/10 dark:bg-sky-950/40 border border-sky-300 dark:border-sky-700/60 flex items-center justify-between gap-3 text-xs text-sky-800 dark:text-sky-200">
                                    <div className="flex items-center gap-2">
                                        <span className="relative flex h-2.5 w-2.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500"></span>
                                        </span>
                                        <span className="font-semibold">
                                            User requested login authorization & schedule extension
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsAllow(true)}
                                        className="px-3 py-1 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-[10px] border border-sky-400/80 shadow-[2px_2px_5px_rgba(2,132,199,0.35),inset_0_1px_1px_rgba(255,255,255,0.4)] transition-all active:scale-95 cursor-pointer shrink-0"
                                    >
                                        Enable Access
                                    </button>
                                </div>
                            )}

                            {/* Permission Toggle (is_allow) */}
                            <div className="p-4 rounded-2xl bg-[#ebf0f7] dark:bg-[#14151c] border border-slate-200/60 dark:border-slate-800 shadow-[inset_1.5px_1.5px_4px_rgba(166,175,195,0.3),inset_-1.5px_-1.5px_4px_rgba(255,255,255,0.85)] dark:shadow-[inset_1.5px_1.5px_4px_rgba(0,0,0,0.65)] flex items-center justify-between">
                                <div>
                                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                        <i className={`fas ${isAllow ? 'fa-lock-open text-pink-500' : 'fa-lock text-rose-500'}`} />
                                        <span>Allow Login Access</span>
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        {isAllow
                                            ? 'Users are authorized to log in during scheduled hours.'
                                            : 'Users are blocked from logging into the portal.'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsAllow(!isAllow)}
                                    className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border border-transparent transition-all duration-200 ease-in-out focus:outline-none ${
                                        isAllow
                                            ? 'bg-pink-600 border-pink-400/80 shadow-[2px_2px_5px_rgba(219,39,119,0.35),inset_0_1px_1px_rgba(255,255,255,0.4)]'
                                            : 'bg-slate-300 dark:bg-slate-700 border-white/60 dark:border-white/[0.06] shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)]'
                                    }`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                                            isAllow ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                    />
                                </button>
                            </div>

                            {/* Allowed Days Picker */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                        <i className="fas fa-calendar-day text-pink-500" />
                                        <span>Allowed Days</span>
                                    </label>
                                    <div className="flex items-center gap-1.5 text-[11px]">
                                        <button
                                            type="button"
                                            onClick={() => setPresetDays('workdays')}
                                            className="px-2.5 py-1 rounded-lg font-bold text-pink-600 dark:text-pink-400 bg-[#f0f3f8] dark:bg-[#14151c] hover:bg-[#e4ebf5] dark:hover:bg-[#232533] border border-white/80 dark:border-slate-700/80 shadow-[2px_2px_4px_rgba(166,175,195,0.35),-2px_-2px_4px_rgba(255,255,255,0.9)] dark:shadow-[2px_2px_4px_rgba(0,0,0,0.5)] active:scale-95 transition-all cursor-pointer"
                                        >
                                            Mon-Fri
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPresetDays('all')}
                                            className="px-2.5 py-1 rounded-lg font-bold text-pink-600 dark:text-pink-400 bg-[#f0f3f8] dark:bg-[#14151c] hover:bg-[#e4ebf5] dark:hover:bg-[#232533] border border-white/80 dark:border-slate-700/80 shadow-[2px_2px_4px_rgba(166,175,195,0.35),-2px_-2px_4px_rgba(255,255,255,0.9)] dark:shadow-[2px_2px_4px_rgba(0,0,0,0.5)] active:scale-95 transition-all cursor-pointer"
                                        >
                                            All Days
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-7 gap-1.5">
                                    {ALL_DAYS.map(d => {
                                        const selected = allowedDays.includes(d.key);
                                        return (
                                            <button
                                                key={d.key}
                                                type="button"
                                                onClick={() => toggleDay(d.key)}
                                                className={`py-2 rounded-xl text-xs font-bold transition-all text-center cursor-pointer active:scale-95 ${
                                                    selected
                                                        ? 'bg-pink-600 text-white border border-pink-400/80 shadow-[2px_2px_6px_rgba(219,39,119,0.35),inset_0_1px_1.5px_rgba(255,255,255,0.4),inset_0_-2px_4px_rgba(0,0,0,0.2)]'
                                                        : 'bg-[#f0f3f8] dark:bg-[#14151c] text-slate-700 dark:text-slate-300 border border-white/80 dark:border-slate-700/80 shadow-[2px_2px_5px_rgba(166,175,195,0.35),-2px_-2px_5px_rgba(255,255,255,0.9)] dark:shadow-[2px_2px_5px_rgba(0,0,0,0.45)] hover:bg-[#e2e9f3] dark:hover:bg-[#232533]'
                                                }`}
                                                title={d.full}
                                            >
                                                {d.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Allowed Time Range (7am - 5pm default) */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                        <i className="fas fa-clock text-pink-500" />
                                        <span>Allowed Time Window</span>
                                    </label>
                                    <div className="flex items-center gap-1.5 text-[11px]">
                                        <button
                                            type="button"
                                            onClick={() => setPresetTime('07:00', '17:00')}
                                            className="px-2 py-1 rounded-lg font-bold text-pink-600 dark:text-pink-400 bg-[#f0f3f8] dark:bg-[#14151c] hover:bg-[#e4ebf5] dark:hover:bg-[#232533] border border-white/80 dark:border-slate-700/80 shadow-[2px_2px_4px_rgba(166,175,195,0.35),-2px_-2px_4px_rgba(255,255,255,0.9)] dark:shadow-[2px_2px_4px_rgba(0,0,0,0.5)] active:scale-95 transition-all cursor-pointer"
                                        >
                                            7 AM - 5 PM
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPresetTime('08:00', '17:00')}
                                            className="px-2 py-1 rounded-lg font-bold text-pink-600 dark:text-pink-400 bg-[#f0f3f8] dark:bg-[#14151c] hover:bg-[#e4ebf5] dark:hover:bg-[#232533] border border-white/80 dark:border-slate-700/80 shadow-[2px_2px_4px_rgba(166,175,195,0.35),-2px_-2px_4px_rgba(255,255,255,0.9)] dark:shadow-[2px_2px_4px_rgba(0,0,0,0.5)] active:scale-95 transition-all cursor-pointer"
                                        >
                                            8 AM - 5 PM
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPresetTime('00:00', '23:59')}
                                            className="px-2 py-1 rounded-lg font-bold text-pink-600 dark:text-pink-400 bg-[#f0f3f8] dark:bg-[#14151c] hover:bg-[#e4ebf5] dark:hover:bg-[#232533] border border-white/80 dark:border-slate-700/80 shadow-[2px_2px_4px_rgba(166,175,195,0.35),-2px_-2px_4px_rgba(255,255,255,0.9)] dark:shadow-[2px_2px_4px_rgba(0,0,0,0.5)] active:scale-95 transition-all cursor-pointer"
                                        >
                                            24/7
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                                            Start Time (From)
                                        </span>
                                        <input
                                            type="time"
                                            value={timeStart}
                                            onChange={(e) => setTimeStart(e.target.value)}
                                            required
                                            className="w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold bg-[#ebf0f7] dark:bg-[#14151c] text-slate-800 dark:text-slate-100 border border-slate-200/60 dark:border-slate-800 shadow-[inset_2px_2px_5px_rgba(166,175,195,0.35),inset_-2px_-2px_5px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.65)] focus:outline-none focus:border-pink-500"
                                        />
                                    </div>
                                    <div>
                                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                                            End Time (Up To)
                                        </span>
                                        <input
                                            type="time"
                                            value={timeEnd}
                                            onChange={(e) => setTimeEnd(e.target.value)}
                                            required
                                            className="w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold bg-[#ebf0f7] dark:bg-[#14151c] text-slate-800 dark:text-slate-100 border border-slate-200/60 dark:border-slate-800 shadow-[inset_2px_2px_5px_rgba(166,175,195,0.35),inset_-2px_-2px_5px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.65)] focus:outline-none focus:border-pink-500"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="pt-2 flex items-center justify-end gap-2.5">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    disabled={isSaving}
                                    className="px-5 py-2.5 rounded-full text-xs font-bold text-slate-700 dark:text-slate-200 bg-[#f0f3f8] dark:bg-[#14151c] hover:bg-[#e4ebf5] dark:hover:bg-[#232533] border border-white/90 dark:border-slate-700/80 shadow-[3px_3px_6px_rgba(166,175,195,0.35),-3px_-3px_6px_rgba(255,255,255,0.95)] dark:shadow-[3px_3px_7px_rgba(0,0,0,0.5)] transition-all cursor-pointer active:scale-95"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="px-6 py-2.5 rounded-full text-xs font-bold text-white bg-pink-600 hover:bg-pink-500 border border-pink-400/80 shadow-[3px_3px_8px_rgba(219,39,119,0.4),inset_0_1px_1.5px_rgba(255,255,255,0.4),inset_0_-2px_4px_rgba(0,0,0,0.25)] transition-all active:scale-95 cursor-pointer disabled:opacity-50 flex items-center gap-2"
                                >
                                    {isSaving ? (
                                        <>
                                            <i className="fas fa-spinner fa-spin" />
                                            <span>Saving...</span>
                                        </>
                                    ) : (
                                        <>
                                            <i className="fas fa-check" />
                                            <span>{isBulkMode ? `Apply to ${bulkSessions?.length} Users` : 'Save Permissions'}</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </div>
            </AnimatePresence>
        </Portal>
    );
};
