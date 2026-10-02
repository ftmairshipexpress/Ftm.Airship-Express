"use client";

import { useState } from "react";
import { toast } from "sonner";
import { receiveAllParcels } from "../../../actions/incoming/parcels";
import { user } from "../../../../../lib/services/Class/user";
import { AppButton } from "../../../../../components/ui/AppButton";
import { StatusBadge } from "../../../../../components/ui/StatusBadge";
import { useConfirm } from "../../../../../components/ui/ConfirmModal";

interface IncomingHeaderProps {
    onReceiveAll?: () => void;
    totalParcels?: number;
}

export default function IncomingHeader({ onReceiveAll, totalParcels = 0 }: IncomingHeaderProps) {
    const [isReceivingAll, setIsReceivingAll] = useState(false);
    const { confirm } = useConfirm();

    const isButtonDisabled = isReceivingAll || totalParcels <= 0;

    const handleReceiveAll = async () => {
        if (isReceivingAll || totalParcels <= 0) return;

        const shouldProceed = await confirm({
            title: "Receive All Incoming Parcels?",
            message: `Are you sure you want to process and receive ${totalParcels > 0 ? `all ${totalParcels}` : 'all'} pending parcels currently in the queue into warehouse inventory?`,
            confirmText: "Yes, Receive All",
            cancelText: "Cancel",
            confirmVariant: "pink",
        });

        if (!shouldProceed) return;

        setIsReceivingAll(true);
        const toastId = toast.loading('Processing receive all...');

        try {
            const currentUserId = user.getUserId();
            const result = await receiveAllParcels(currentUserId || undefined);

            if (!result.success) {
                toast.error(result.error || 'Failed to receive parcels', {
                    id: toastId,
                    duration: 5000,
                });
                return;
            }

            if (result.data?.warning) {
                toast.warning(`Received ${result.data.received} parcels with warnings`, {
                    id: toastId,
                    duration: 3000,
                });
            } else {
                toast.success(`Successfully received ${result.data?.received || 0} parcels`, {
                    id: toastId,
                    duration: 3000,
                });
            }

            onReceiveAll?.();
        } catch (error) {
            console.error('Error receiving all:', error);
            toast.error('Failed to receive parcels', {
                id: toastId,
                description: error instanceof Error ? error.message : 'Please try again',
                duration: 5000,
            });
        } finally {
            setIsReceivingAll(false);
        }
    };

    return (
        <div className="flex flex-col gap-4 pb-4 border-b border-slate-200/80 dark:border-white/[0.06] sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#ebf0f7] dark:bg-[#12131d] text-pink-600 dark:text-pink-400 border border-white/90 dark:border-white/[0.06] shadow-[inset_1.5px_1.5px_3px_rgba(166,175,195,0.35),inset_-1.5px_-1.5px_3px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.6)]">
                        <i className="fas fa-arrow-down text-sm" aria-hidden="true" />
                    </div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                        Incoming Receiving
                    </h1>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 sm:text-sm">
                    <StatusBadge tone="pink" size="xs">
                        Batch <strong className="font-mono font-bold">#B-2407</strong>
                    </StatusBadge>
                    <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">•</span>
                    <span>Warehouse 1</span>
                    <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">•</span>
                    <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
                        Operator: <strong className="font-semibold text-slate-900 dark:text-white">{user.getName()}</strong>
                    </span>
                </div>
            </div>

            <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                <AppButton
                    type="button"
                    variant="pink"
                    size="md"
                    onClick={handleReceiveAll}
                    disabled={isButtonDisabled}
                    loading={isReceivingAll}
                    title={totalParcels <= 0 ? "No pending parcels to receive" : "Receive all pending parcels into inventory"}
                    className="w-full sm:w-auto min-w-[140px] shadow-[2px_2px_6px_rgba(236,72,153,0.35)] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                >
                    <i className="fas fa-check-circle text-xs" />
                    <span>{isReceivingAll ? 'Processing...' : 'Receive All'}</span>
                </AppButton>
            </div>
        </div>
    );
}