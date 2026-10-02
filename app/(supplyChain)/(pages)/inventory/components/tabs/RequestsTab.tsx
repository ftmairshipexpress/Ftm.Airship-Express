'use client';

import { useState, useEffect, memo, useCallback } from 'react';
import { InventoryRequest, InventoryItem } from '../../types';
import { sanitizeSearch } from '../../../../components/global/sanitize';
import { Pagination } from '../../../../components/global/pagination';
import { TableRowsSkeleton } from '../../../../components/ui/SkeletonLoader';
import { AppButton } from '../../../../components/ui/AppButton';
import { CrudActionButton } from '../../../../components/ui/CrudActionButton';
import { StatusBadge } from '../../../../components/ui/StatusBadge';
import { useConfirm } from '../../../../components/ui/ConfirmModal';
import { toast } from 'sonner';
import { supabase } from '../../../../lib/services/client/supabase';
import { user } from '../../../../lib/services/Class/user';
import { 
    Inbox, 
    Clock, 
    CheckCircle2, 
    XCircle, 
    PackageCheck, 
    ArrowUpRight, 
    AlertTriangle, 
    Plus, 
    Building2, 
    User, 
    Filter, 
    Search,
    Layers,
    Check,
    X,
    FileText,
    ChevronDown,
    Bell,
    RotateCw
} from 'lucide-react';
import Portal from '../../../../components/client/Portal';
import { approveInventoryRequest, rejectInventoryRequest } from '../../server/query';

interface RequestsTabProps {
    requests: InventoryRequest[];
    inventoryItems: InventoryItem[];
    totalRequests: number;
    currentPage: number;
    totalPages: number;
    stats: {
        total: number;
        pending: number;
        approved: number;
        received: number;
        rejected: number;
    } | null;
    isLoading?: boolean;
    userRole?: string;
    searchTerm: string;
    statusFilter: string;
    typeFilter: 'all' | 'internal' | 'external';
    onSearchChange: (value: string) => void;
    onStatusChange: (value: string) => void;
    onTypeChange: (value: 'all' | 'internal' | 'external') => void;
    onPageChange: (page: number) => void;
    onOpenInternalRequestModal: () => void;
    onOpenReleaseModal: (req: InventoryRequest) => void;
    onRefresh: () => void;
}

export const RequestsTab = memo(function RequestsTab({
    requests,
    inventoryItems,
    totalRequests,
    currentPage,
    totalPages,
    stats,
    isLoading = false,
    userRole = '',
    searchTerm,
    statusFilter,
    typeFilter,
    onSearchChange,
    onStatusChange,
    onTypeChange,
    onPageChange,
    onOpenInternalRequestModal,
    onOpenReleaseModal,
    onRefresh,
}: RequestsTabProps) {
    const { confirm } = useConfirm();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [rejectingRequest, setRejectingRequest] = useState<InventoryRequest | null>(null);
    const [rejectionReason, setRejectionReason] = useState<string>('');
    const [showBulkRejectModal, setShowBulkRejectModal] = useState<boolean>(false);
    const [bulkRejectReason, setBulkRejectReason] = useState<string>('');
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
    const [notifiedRequestIds, setNotifiedRequestIds] = useState<Set<string>>(() => new Set());

    // Load notified request IDs from localStorage and Supabase notifications
    useEffect(() => {
        try {
            const stored = localStorage.getItem('notified_inventory_request_ids');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    setNotifiedRequestIds(prev => new Set([...prev, ...parsed]));
                }
            }
        } catch (e) {}

        if (requests.length > 0) {
            const ids = requests.map(r => r.id).filter(Boolean);
            supabase
                .from('notifications')
                .select('reference_id')
                .eq('reference_type', 'inventory_request')
                .in('reference_id', ids)
                .then(({ data, error }) => {
                    if (!error && data && data.length > 0) {
                        const foundIds = data.map((d: any) => d.reference_id).filter(Boolean);
                        setNotifiedRequestIds(prev => {
                            const next = new Set(prev);
                            foundIds.forEach((id: string) => next.add(id));
                            try {
                                localStorage.setItem('notified_inventory_request_ids', JSON.stringify(Array.from(next)));
                            } catch (e) {}
                            return next;
                        });
                    }
                });
        }
    }, [requests]);

    const currentRole = userRole || user.getRole();
    const canManageRequests = currentRole === 'Admin' || currentRole === 'Executive';

    const allSelected = requests.length > 0 && requests.every(r => selectedIds.has(r.id));
    const someSelected = requests.some(r => selectedIds.has(r.id)) && !allSelected;

    const handleSelectAll = useCallback(() => {
        if (allSelected) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(requests.map(r => r.id)));
        }
    }, [allSelected, requests]);

    const handleSelectOne = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const handleApprove = async (req: InventoryRequest) => {
        if (!canManageRequests) {
            toast.info("Only Admin and Executive can approve inventory requests.", {
                id: `approve-restricted-${req.id}`
            });
            return;
        }

        const confirmed = await confirm({
            title: 'Approve Inventory Request',
            message: `Are you sure you want to approve request #${req.request_number || (req.id ? req.id.slice(0, 8) : '')} for ${req.quantity_requested || 1} unit(s) of "${req.item_name}"? This will allocate stock for export/release.`,
            confirmText: 'Approve Request',
            confirmVariant: 'success'
        });
        if (!confirmed) return;

        setActionLoadingId(req.id);
        const toastId = toast.loading(`Approving request #${req.request_number || req.id.slice(0, 8)}...`);
        try {
            const res = await approveInventoryRequest(req.id, userRole || 'Executive');
            if (res.success) {
                toast.success(res.message || 'Request approved successfully! Stock allocated for export.', { id: toastId });
                onRefresh();
            } else {
                toast.error(res.error || 'Failed to approve request', { id: toastId });
            }
        } catch (err: any) {
            console.error('Error approving request:', err);
            toast.error(err?.message || 'Failed to approve request', { id: toastId });
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleBulkApprove = async () => {
        if (!canManageRequests) {
            toast.info("Only Admin and Executive can approve inventory requests.");
            return;
        }

        const pendingSelected = requests.filter(r => selectedIds.has(r.id) && (r.status || 'pending').toLowerCase() === 'pending');
        if (pendingSelected.length === 0) {
            toast.warning('No pending requests found in the current selection.');
            return;
        }

        const confirmed = await confirm({
            title: `Approve ${pendingSelected.length} Requests`,
            message: `Are you sure you want to approve ${pendingSelected.length} pending request(s)? This will allocate stock for export/release.`,
            confirmText: `Approve (${pendingSelected.length})`,
            confirmVariant: 'success'
        });
        if (!confirmed) return;

        setActionLoadingId('bulk-approve');
        const toastId = toast.loading(`Approving ${pendingSelected.length} requests...`);
        try {
            const results = await Promise.all(
                pendingSelected.map(r => approveInventoryRequest(r.id, userRole || 'Executive'))
            );
            const successCount = results.filter(r => r.success).length;
            if (successCount > 0) {
                toast.success(`Successfully approved ${successCount} request(s)!`, { id: toastId });
                setSelectedIds(new Set());
                onRefresh();
            } else {
                toast.error('Failed to approve selected requests', { id: toastId });
            }
        } catch (err: any) {
            console.error('Bulk approve error:', err);
            toast.error(err?.message || 'Failed to approve requests', { id: toastId });
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleConfirmBulkReject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canManageRequests) {
            toast.error('Only Admin and Executive can reject inventory requests in bulk.');
            setShowBulkRejectModal(false);
            return;
        }
        const pendingSelected = requests.filter(r => selectedIds.has(r.id) && (r.status || 'pending').toLowerCase() === 'pending');
        if (pendingSelected.length === 0) {
            toast.warning('No pending requests found in current selection');
            setShowBulkRejectModal(false);
            return;
        }

        setActionLoadingId('bulk-reject');
        const toastId = toast.loading(`Rejecting ${pendingSelected.length} requests...`);
        const trimmedReason = bulkRejectReason.trim() || 'Declined in bulk by inventory manager';

        try {
            const results = await Promise.all(
                pendingSelected.map(r => rejectInventoryRequest(r.id, trimmedReason, userRole || 'Manager'))
            );
            const successCount = results.filter(r => r.success).length;

            // Send batch notification to Admin & Executive
            try {
                const currentName = user.getName() || user.getEmail() || 'Inventory Staff';
                const currentEmail = user.getEmail() || 'system@airship.com';
                await supabase
                    .from('notifications')
                    .insert({
                        creator_name: currentName,
                        creator_email: currentEmail,
                        title: `Bulk Requisitions Rejected (${successCount} requests)`,
                        message: `${successCount} inventory request(s) were rejected in bulk. Reason: "${trimmedReason}".`,
                        type: 'alert',
                        link: `/inventory?tab=requests&status=rejected`,
                        role: ['Admin', 'Executive'],
                        is_read: false
                    });
            } catch (notifErr) {
                console.error('Auto notification error on bulk reject:', notifErr);
            }

            toast.success(`Rejected ${successCount} request(s) & Admin notified!`, { id: toastId });
            setShowBulkRejectModal(false);
            setBulkRejectReason('');
            setSelectedIds(new Set());
            onRefresh();
        } catch (err: any) {
            console.error('Bulk reject error:', err);
            toast.error(err?.message || 'Failed to reject requests', { id: toastId });
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleNotifyAdminExecutive = async (req: InventoryRequest, customReason?: string) => {
        const notifyKey = `notify-${req.id}`;
        const isFollowUp = notifiedRequestIds.has(req.id);
        setActionLoadingId(notifyKey);
        const toastId = toast.loading(`${isFollowUp ? 'Sending follow-up to' : 'Notifying'} Admin & Executive about request #${req.request_number || req.id.slice(0, 8)}...`);

        try {
            const currentName = user.getName() || user.getEmail() || 'Inventory Staff';
            const currentEmail = user.getEmail() || 'system@airship.com';
            const isReqPending = (req.status || 'pending').toLowerCase() === 'pending';
            const reasonText = customReason || req.rejection_reason || (isReqPending ? 'Review requested by inventory staff' : 'Declined by inventory manager');

            const prefix = isFollowUp ? '[Follow Up] ' : '';
            const title = isReqPending
                ? `${prefix}Requisition Pending Review: #${req.request_number || (req.id ? req.id.slice(0, 8) : '')}`
                : `${prefix}Requisition Rejected: #${req.request_number || (req.id ? req.id.slice(0, 8) : '')}`;

            const message = isFollowUp
                ? `Follow-up reminder: Inventory request #${req.request_number || req.id.slice(0, 8)} for ${req.quantity_requested || 1} unit(s) of "${req.item_name}" is awaiting review/action. Requester: ${req.requested_by || 'Staff'} (${req.department || 'General'}).`
                : (isReqPending
                    ? `Inventory request #${req.request_number || req.id.slice(0, 8)} for ${req.quantity_requested || 1} unit(s) of "${req.item_name}" requires review & approval. Requester: ${req.requested_by || 'Staff'} (${req.department || 'General'}).`
                    : `Inventory request #${req.request_number || req.id.slice(0, 8)} for ${req.quantity_requested || 1} unit(s) of "${req.item_name}" was rejected. Reason: "${reasonText}". Requester: ${req.requested_by || 'Staff'} (${req.department || 'General'}).`);

            const { error } = await supabase
                .from('notifications')
                .insert({
                    creator_name: currentName,
                    creator_email: currentEmail,
                    title,
                    message,
                    type: 'alert',
                    link: `/inventory?tab=requests&search=${encodeURIComponent(req.request_number || req.item_name)}`,
                    role: ['Admin', 'Executive'],
                    is_read: false,
                    reference_type: 'inventory_request',
                    reference_id: req.id
                });

            if (error) throw error;

            // Mark as notified in state & localStorage
            setNotifiedRequestIds(prev => {
                const next = new Set(prev);
                next.add(req.id);
                try {
                    localStorage.setItem('notified_inventory_request_ids', JSON.stringify(Array.from(next)));
                } catch (e) {}
                return next;
            });

            toast.success(isFollowUp ? 'Follow-up sent to Admin & Executive!' : 'Admin & Executive have been notified!', { id: toastId });
        } catch (err: any) {
            console.error('Error notifying Admin & Executive:', err);
            toast.error(err?.message || 'Failed to send notification', { id: toastId });
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleBulkNotifyAdmin = async () => {
        const selectedList = requests.filter(r => selectedIds.has(r.id));
        if (selectedList.length === 0) {
            toast.warning('Please select at least one request');
            return;
        }

        const rejectedSelected = selectedList.filter(r => (r.status || '').toLowerCase() === 'rejected');
        const targetList = rejectedSelected.length > 0 ? rejectedSelected : selectedList;
        const allAlreadyNotified = targetList.length > 0 && targetList.every(r => notifiedRequestIds.has(r.id));
        const isFollowUp = allAlreadyNotified;

        const confirmed = await confirm({
            title: isFollowUp ? `Send Follow-up (${targetList.length})` : `Notify Admin & Executive (${targetList.length})`,
            message: `${isFollowUp ? 'Send a follow-up reminder' : 'Send an alert notification'} to Admin and Executive for the ${targetList.length} selected request(s)?`,
            confirmText: isFollowUp ? `Send Follow-up` : `Notify Admin & Executive`,
            confirmVariant: 'info'
        });
        if (!confirmed) return;

        setActionLoadingId('bulk-notify');
        const toastId = toast.loading(`${isFollowUp ? 'Sending follow-up to' : 'Notifying'} Admin & Executive about ${targetList.length} request(s)...`);

        try {
            const currentName = user.getName() || user.getEmail() || 'Inventory Staff';
            const currentEmail = user.getEmail() || 'system@airship.com';

            const summaryText = targetList
                .map(r => `#${r.request_number || r.id.slice(0, 8)} (${r.item_name})`)
                .slice(0, 4)
                .join(', ') + (targetList.length > 4 ? ` and ${targetList.length - 4} more` : '');

            const prefix = isFollowUp ? '[Follow Up] ' : '';
            const { error } = await supabase
                .from('notifications')
                .insert({
                    creator_name: currentName,
                    creator_email: currentEmail,
                    title: `${prefix}Requisitions Notification (${targetList.length} items)`,
                    message: `${isFollowUp ? 'Follow-up reminder for' : 'Requisition alert for'} ${targetList.length} item(s): ${summaryText}.`,
                    type: 'alert',
                    link: `/inventory?tab=requests`,
                    role: ['Admin', 'Executive'],
                    is_read: false
                });

            if (error) throw error;

            // Mark target list as notified
            setNotifiedRequestIds(prev => {
                const next = new Set(prev);
                targetList.forEach(r => next.add(r.id));
                try {
                    localStorage.setItem('notified_inventory_request_ids', JSON.stringify(Array.from(next)));
                } catch (e) {}
                return next;
            });

            toast.success(isFollowUp ? `Follow-up sent for ${targetList.length} request(s)!` : `Admin & Executive notified about ${targetList.length} request(s)!`, { id: toastId });
            setSelectedIds(new Set());
        } catch (err: any) {
            console.error('Bulk notify error:', err);
            toast.error(err?.message || 'Failed to send bulk notification', { id: toastId });
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleConfirmReject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!rejectingRequest) return;
        if (!canManageRequests) {
            toast.error('Only Admin and Executive can reject inventory requests.');
            setRejectingRequest(null);
            return;
        }

        setActionLoadingId(rejectingRequest.id);
        const toastId = toast.loading(`Rejecting request #${rejectingRequest.request_number}...`);
        const trimmedReason = rejectionReason.trim() || 'Declined by inventory manager';

        try {
            const res = await rejectInventoryRequest(
                rejectingRequest.id,
                trimmedReason,
                userRole || 'Manager'
            );
            if (res.success) {
                // Automatically send notification to Admin & Executive
                try {
                    const currentName = user.getName() || user.getEmail() || 'Inventory Staff';
                    const currentEmail = user.getEmail() || 'system@airship.com';
                    await supabase
                        .from('notifications')
                        .insert({
                            creator_name: currentName,
                            creator_email: currentEmail,
                            title: `Requisition Rejected: #${rejectingRequest.request_number || (rejectingRequest.id ? rejectingRequest.id.slice(0, 8) : '')}`,
                            message: `Inventory request #${rejectingRequest.request_number || rejectingRequest.id.slice(0, 8)} for ${rejectingRequest.quantity_requested || 1} unit(s) of "${rejectingRequest.item_name}" has been rejected. Reason: "${trimmedReason}". Requester: ${rejectingRequest.requested_by || 'Staff'} (${rejectingRequest.department || 'General'}).`,
                            type: 'alert',
                            link: `/inventory?tab=requests&search=${encodeURIComponent(rejectingRequest.request_number || rejectingRequest.item_name)}`,
                            role: ['Admin', 'Executive'],
                            is_read: false
                        });
                } catch (notifErr) {
                    console.error('Auto notification error on reject:', notifErr);
                }

                toast.success('Request rejected & Admin notified!', { id: toastId });
                setRejectingRequest(null);
                setRejectionReason('');
                onRefresh();
            } else {
                toast.error(res.error || 'Failed to reject request', { id: toastId });
            }
        } catch (err: any) {
            console.error('Error rejecting request:', err);
            toast.error(err?.message || 'Failed to reject request', { id: toastId });
        } finally {
            setActionLoadingId(null);
        }
    };

    const itemsPerPage = 20;
    const startIndex = totalRequests === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
    const endIndex = Math.min(currentPage * itemsPerPage, totalRequests);

    return (
        <div className="space-y-6">
            {/* Top KPI Cards - Minimalist & Calm */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {/* Total Requests */}
                <div className="p-4 sm:p-5 rounded-3xl bg-[#f0f3f8] dark:bg-[#161722] border border-white/90 dark:border-white/[0.08] shadow-[6px_6px_16px_rgba(166,175,195,0.25),-6px_-6px_16px_rgba(255,255,255,0.85)] dark:shadow-[8px_8px_20px_rgba(0,0,0,0.5)] flex items-center justify-between transition-all">
                    <div className="space-y-0.5">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            Total Requests
                        </span>
                        <h4 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100 font-mono tracking-tight">
                            {stats?.total || 0}
                        </h4>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">
                            All incoming requisitions
                        </p>
                    </div>
                    <div className="w-11 h-11 rounded-2xl bg-[#ebf0f7] dark:bg-[#12131b] border border-white/80 dark:border-white/[0.05] shadow-[inset_1.5px_1.5px_3px_rgba(166,175,195,0.3),inset_-1.5px_-1.5px_3px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.5)] flex items-center justify-center text-slate-500 dark:text-slate-400">
                        <Inbox className="w-5 h-5 stroke-[1.75]" />
                    </div>
                </div>

                {/* Pending Review */}
                <div className="p-4 sm:p-5 rounded-3xl bg-[#f0f3f8] dark:bg-[#161722] border border-white/90 dark:border-white/[0.08] shadow-[6px_6px_16px_rgba(166,175,195,0.25),-6px_-6px_16px_rgba(255,255,255,0.85)] dark:shadow-[8px_8px_20px_rgba(0,0,0,0.5)] flex items-center justify-between transition-all">
                    <div className="space-y-0.5">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            Pending Review
                        </span>
                        <h4 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100 font-mono tracking-tight">
                            {stats?.pending || 0}
                        </h4>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">
                            Awaiting stock feasibility
                        </p>
                    </div>
                    <div className="w-11 h-11 rounded-2xl bg-[#ebf0f7] dark:bg-[#12131b] border border-white/80 dark:border-white/[0.05] shadow-[inset_1.5px_1.5px_3px_rgba(166,175,195,0.3),inset_-1.5px_-1.5px_3px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.5)] flex items-center justify-center text-slate-500 dark:text-slate-400">
                        <Clock className="w-5 h-5 stroke-[1.75]" />
                    </div>
                </div>

                {/* Approved (Exporting) */}
                <div className="p-4 sm:p-5 rounded-3xl bg-[#f0f3f8] dark:bg-[#161722] border border-white/90 dark:border-white/[0.08] shadow-[6px_6px_16px_rgba(166,175,195,0.25),-6px_-6px_16px_rgba(255,255,255,0.85)] dark:shadow-[8px_8px_20px_rgba(0,0,0,0.5)] flex items-center justify-between transition-all">
                    <div className="space-y-0.5">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            Approved (Exporting)
                        </span>
                        <h4 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100 font-mono tracking-tight">
                            {stats?.approved || 0}
                        </h4>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">
                            Committed ready for release
                        </p>
                    </div>
                    <div className="w-11 h-11 rounded-2xl bg-[#ebf0f7] dark:bg-[#12131b] border border-white/80 dark:border-white/[0.05] shadow-[inset_1.5px_1.5px_3px_rgba(166,175,195,0.3),inset_-1.5px_-1.5px_3px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.5)] flex items-center justify-center text-slate-500 dark:text-slate-400">
                        <PackageCheck className="w-5 h-5 stroke-[1.75]" />
                    </div>
                </div>

                {/* Received / Outed */}
                <div className="p-4 sm:p-5 rounded-3xl bg-[#f0f3f8] dark:bg-[#161722] border border-white/90 dark:border-white/[0.08] shadow-[6px_6px_16px_rgba(166,175,195,0.25),-6px_-6px_16px_rgba(255,255,255,0.85)] dark:shadow-[8px_8px_20px_rgba(0,0,0,0.5)] flex items-center justify-between transition-all">
                    <div className="space-y-0.5">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            Received / Outed
                        </span>
                        <h4 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100 font-mono tracking-tight">
                            {stats?.received || 0}
                        </h4>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">
                            Fulfilled and stock deducted
                        </p>
                    </div>
                    <div className="w-11 h-11 rounded-2xl bg-[#ebf0f7] dark:bg-[#12131b] border border-white/80 dark:border-white/[0.05] shadow-[inset_1.5px_1.5px_3px_rgba(166,175,195,0.3),inset_-1.5px_-1.5px_3px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.5)] flex items-center justify-center text-slate-500 dark:text-slate-400">
                        <CheckCircle2 className="w-5 h-5 stroke-[1.75]" />
                    </div>
                </div>
            </div>

            {/* Main Table Card */}
            <div className="bg-[#f0f3f8] dark:bg-[#161722] rounded-3xl border border-white/90 dark:border-white/[0.08] shadow-[14px_14px_40px_rgba(166,175,195,0.35),-14px_-14px_40px_rgba(255,255,255,0.95)] dark:shadow-[14px_14px_40px_rgba(0,0,0,0.8),-4px_-4px_12px_rgba(255,255,255,0.03)] overflow-hidden transition-colors flex flex-col">
                {/* Filter Toolbar */}
                <div className="flex-shrink-0 p-4 sm:p-5 border-b border-slate-200/60 dark:border-white/[0.06] flex flex-wrap items-center justify-between gap-3 bg-[#ebf0f7]/70 dark:bg-[#14151e]/60 backdrop-blur-md">
                    <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
                        {/* Search Input */}
                        <div className="relative flex-1 min-w-[200px] max-w-xs group">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none group-focus-within:text-pink-500 transition-colors w-4 h-4" />
                            <input
                                className="w-full bg-[#ebf0f7] dark:bg-[#12131b] border border-white/80 dark:border-white/[0.06] rounded-2xl px-3.5 py-2.5 pl-9 text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 shadow-[inset_1.5px_1.5px_3px_rgba(166,175,195,0.35),inset_-1.5px_-1.5px_3px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.6)] focus:outline-none focus:border-pink-500"
                                placeholder="Search by item, request code, requester..."
                                value={searchTerm}
                                onChange={(e) => onSearchChange(sanitizeSearch(e.target.value))}
                            />
                        </div>

                        {/* Status Filter */}
                        <div className="relative min-w-[140px] group">
                            <select
                                className="w-full appearance-none bg-[#ebf0f7] dark:bg-[#12131b] border border-white/80 dark:border-white/[0.06] rounded-2xl px-3.5 py-2.5 pl-4 pr-8 text-xs font-semibold text-slate-800 dark:text-slate-100 shadow-[inset_1.5px_1.5px_3px_rgba(166,175,195,0.35),inset_-1.5px_-1.5px_3px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.6)] focus:outline-none focus:border-pink-500 cursor-pointer"
                                value={statusFilter}
                                onChange={(e) => onStatusChange(e.target.value)}
                            >
                                <option value="all">All Statuses</option>
                                <option value="pending">Pending</option>
                                <option value="approved">Approved</option>
                                <option value="received">Received / Outed</option>
                                <option value="rejected">Rejected</option>
                            </select>
                            <ChevronDown className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
                        </div>

                        {/* Origin Filter */}
                        <div className="relative min-w-[170px] group">
                            <select
                                className="w-full appearance-none bg-[#ebf0f7] dark:bg-[#12131b] border border-white/80 dark:border-white/[0.06] rounded-2xl px-3.5 py-2.5 pl-4 pr-8 text-xs font-semibold text-slate-800 dark:text-slate-100 shadow-[inset_1.5px_1.5px_3px_rgba(166,175,195,0.35),inset_-1.5px_-1.5px_3px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.6)] focus:outline-none focus:border-pink-500 cursor-pointer"
                                value={typeFilter}
                                onChange={(e) => onTypeChange(e.target.value as any)}
                            >
                                <option value="all">All Requisition Sources</option>
                                <option value="internal">Internal Requisitions</option>
                                <option value="external">External Systems</option>
                            </select>
                            <ChevronDown className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
                        </div>
                    </div>

                    {/* New Internal Request Action */}
                    <div className="flex items-center gap-2">
                        <AppButton type="button" variant="primary" size="md" onClick={onOpenInternalRequestModal}>
                            <Plus className="w-4 h-4 mr-1.5" />
                            <span>New Internal Request</span>
                        </AppButton>
                    </div>
                </div>

                {/* Bulk Action Toolbar */}
                {selectedIds.size > 0 && (
                    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-pink-50/70 dark:bg-pink-950/30 border-b border-pink-200/70 dark:border-pink-900/40 text-xs animate-in fade-in duration-150">
                        <span className="font-bold text-pink-600 dark:text-pink-400 font-mono flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
                            {selectedIds.size} request(s) selected
                        </span>
                        <div className="h-4 w-px bg-pink-200 dark:bg-pink-800 mx-1 hidden sm:block" />

                        {canManageRequests && (
                            <>
                                {/* Bulk Approve */}
                                <button
                                    type="button"
                                    onClick={handleBulkApprove}
                                    disabled={actionLoadingId === 'bulk-approve'}
                                    className="px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95 bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20"
                                    title="Approve selected pending requests"
                                >
                                    {actionLoadingId === 'bulk-approve' ? (
                                        <i className="fas fa-spinner fa-spin text-xs" />
                                    ) : (
                                        <Check className="w-3.5 h-3.5" />
                                    )}
                                    <span>Approve Selected</span>
                                </button>

                                {/* Bulk Reject */}
                                <button
                                    type="button"
                                    onClick={() => {
                                        const pendingCount = requests.filter(r => selectedIds.has(r.id) && (r.status || 'pending').toLowerCase() === 'pending').length;
                                        if (pendingCount === 0) {
                                            toast.warning('No pending requests found in the current selection');
                                            return;
                                        }
                                        setShowBulkRejectModal(true);
                                    }}
                                    disabled={actionLoadingId === 'bulk-reject'}
                                    className="px-3 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs shadow-rose-500/20 active:scale-95"
                                    title="Reject selected pending requests"
                                >
                                    {actionLoadingId === 'bulk-reject' ? (
                                        <i className="fas fa-spinner fa-spin text-xs" />
                                    ) : (
                                        <X className="w-3.5 h-3.5" />
                                    )}
                                    <span>Reject Selected</span>
                                </button>
                            </>
                        )}

                        {/* Bulk Notify / Follow Up Admin */}
                        <button
                            type="button"
                            onClick={handleBulkNotifyAdmin}
                            disabled={actionLoadingId === 'bulk-notify'}
                            className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs shadow-amber-500/20 active:scale-95"
                            title="Notify or follow up with Admin & Executive about selected requests"
                        >
                            {actionLoadingId === 'bulk-notify' ? (
                                <i className="fas fa-spinner fa-spin text-xs" />
                            ) : requests.filter(r => selectedIds.has(r.id)).length > 0 && requests.filter(r => selectedIds.has(r.id)).every(r => notifiedRequestIds.has(r.id)) ? (
                                <RotateCw className="w-3.5 h-3.5" />
                            ) : (
                                <Bell className="w-3.5 h-3.5" />
                            )}
                            <span>
                                {requests.filter(r => selectedIds.has(r.id)).length > 0 && requests.filter(r => selectedIds.has(r.id)).every(r => notifiedRequestIds.has(r.id))
                                    ? 'Follow Up Admin & Exec'
                                    : 'Notify Admin & Exec'}
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setSelectedIds(new Set())}
                            className="ml-auto text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-semibold underline text-[11px] cursor-pointer"
                        >
                            Deselect All
                        </button>
                    </div>
                )}

                {/* Table Content */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200/60 dark:border-white/[0.06] text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider bg-[#ebf0f7]/40 dark:bg-[#12131b]/40">
                                <th className="w-10 px-3.5 py-3.5 text-center">
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        ref={(input) => {
                                            if (input) {
                                                input.indeterminate = someSelected;
                                            }
                                        }}
                                        onChange={handleSelectAll}
                                        aria-label="Select all requests"
                                        className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-pink-500 focus:ring-pink-500/20 cursor-pointer accent-pink-500 transition-colors"
                                    />
                                </th>
                                <th className="px-4 py-3.5 whitespace-nowrap">Request #</th>
                                <th className="px-4 py-3.5 whitespace-nowrap">Source</th>
                                <th className="px-4 py-3.5 whitespace-nowrap">Date</th>
                                <th className="px-4 py-3.5 whitespace-nowrap">Department</th>
                                <th className="px-4 py-3.5 whitespace-nowrap">Requester</th>
                                <th className="px-4 py-3.5">Requested Item</th>
                                <th className="px-4 py-3.5 text-center whitespace-nowrap">Qty</th>
                                <th className="px-4 py-3.5 whitespace-nowrap">Stock Feasibility</th>
                                <th className="px-4 py-3.5 whitespace-nowrap">Status</th>
                                <th className="px-4 py-3.5 text-right whitespace-nowrap">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/50 dark:divide-white/[0.04] text-xs">
                            {isLoading ? (
                                <TableRowsSkeleton
                                    rows={8}
                                    columns={[
                                        { type: 'checkbox', width: 'w-10' },
                                        { type: 'mono', width: 'w-24' },
                                        { type: 'badge', width: 'w-16' },
                                        { type: 'text', width: 'w-24' },
                                        { type: 'text', width: 'w-28' },
                                        { type: 'text', width: 'w-32' },
                                        { type: 'text', width: 'w-40' },
                                        { type: 'mono', width: 'w-10', align: 'center' },
                                        { type: 'badge', width: 'w-32' },
                                        { type: 'badge', width: 'w-24' },
                                        { type: 'actions', align: 'right', width: 'w-24' },
                                    ]}
                                />
                            ) : requests.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="py-20 text-center text-slate-400 dark:text-slate-500">
                                        <div className="flex flex-col items-center justify-center gap-3">
                                            <div className="w-14 h-14 rounded-2xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center text-slate-400 dark:text-slate-500 shadow-inner">
                                                <Inbox className="w-7 h-7" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-slate-700 dark:text-slate-200 text-sm">No inventory requests found</p>
                                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                                    Incoming requests from external systems or internal staff will show up here.
                                                </p>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                requests.map((req) => {
                                    const status = (req.status || 'pending').toLowerCase();
                                    const isPending = status === 'pending';
                                    const isApproved = status === 'approved';
                                    const isReceived = status === 'received' || status === 'fulfilled';
                                    const isRejected = status === 'rejected';

                                    const isInternal = req.Internal_request === true || req.internal_request === true || req.is_internal === true || Boolean(req.requested_by);
                                    
                                    // Matched item stock data
                                    const item = (req as any).inventory_item;
                                    const currentStock = (req as any).current_stock ?? item?.current_stock ?? 0;
                                    const availableStock = (req as any).available_stock ?? item?.available_stock ?? currentStock;
                                    const requestedQty = Number(req.quantity_requested || 1);
                                    const isStockFeasible = availableStock >= requestedQty && currentStock > 0;
                                    const isOutOfStock = currentStock <= 0;

                                    return (
                                        <tr
                                            key={req.id}
                                            className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors duration-150 ${selectedIds.has(req.id) ? 'bg-pink-50/30 dark:bg-pink-950/10' : ''}`}
                                        >
                                            {/* 0. Checkbox */}
                                            <td className="w-10 px-3.5 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(req.id)}
                                                    onChange={() => handleSelectOne(req.id)}
                                                    aria-label={`Select request #${req.request_number || req.id.slice(0, 8)}`}
                                                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-pink-500 focus:ring-pink-500/20 cursor-pointer accent-pink-500 transition-colors"
                                                />
                                            </td>

                                            {/* 1. Request # */}
                                            <td className="px-4 py-3.5 whitespace-nowrap">
                                                <span className="font-mono font-bold text-slate-900 dark:text-slate-100 bg-[#ebf0f7] dark:bg-[#12131b] px-2.5 py-1 rounded-lg border border-white/80 dark:border-white/[0.05] shadow-inner text-[11px]">
                                                    {req.request_number || `#${req.id.slice(0, 8)}`}
                                                </span>
                                            </td>

                                            {/* 2. Source */}
                                            <td className="px-4 py-3.5 whitespace-nowrap">
                                                <StatusBadge
                                                    tone="neutral"
                                                    size="xs"
                                                >
                                                    {isInternal ? 'Internal' : 'External'}
                                                </StatusBadge>
                                            </td>

                                            {/* 3. Date */}
                                            <td className="px-4 py-3.5 whitespace-nowrap text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                                                {req.created_at ? (
                                                    new Date(req.created_at).toLocaleDateString(undefined, {
                                                        month: 'short',
                                                        day: 'numeric',
                                                        year: 'numeric'
                                                    })
                                                ) : (
                                                    <span className="text-slate-400 italic">Recent</span>
                                                )}
                                            </td>

                                            {/* 4. Department */}
                                            <td className="px-4 py-3.5 whitespace-nowrap">
                                                <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
                                                    <Building2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                                    <span>{req.department || 'General'}</span>
                                                </div>
                                            </td>

                                            {/* 5. Requester */}
                                            <td className="px-4 py-3.5 whitespace-nowrap">
                                                <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                                                    <User className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                                    <span className="truncate max-w-[140px]" title={(req as any).requester_name || (isInternal ? 'Internal Staff' : (req.requester_system || 'External System'))}>
                                                        {(req as any).requester_name || (isInternal ? (req.department ? `${req.department} Staff` : 'Internal Staff') : (req.requester_system || 'External System'))}
                                                    </span>
                                                </div>
                                            </td>

                                            {/* 6. Requested Item */}
                                            <td className="px-4 py-3.5">
                                                <span className="font-extrabold text-slate-900 dark:text-slate-100 block truncate max-w-[200px]" title={req.item_name}>
                                                    {req.item_name}
                                                </span>
                                            </td>

                                            {/* 7. Quantity */}
                                            <td className="px-4 py-3.5 text-center font-mono font-extrabold text-slate-900 dark:text-slate-100 text-sm whitespace-nowrap">
                                                {requestedQty}
                                            </td>

                                            {/* 8. Stock Feasibility */}
                                            <td className="px-4 py-3.5 whitespace-nowrap">
                                                {isOutOfStock ? (
                                                    <span className="text-slate-500 dark:text-slate-400 text-[11px] font-medium inline-flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
                                                        Out of stock
                                                    </span>
                                                ) : !isStockFeasible ? (
                                                    <span className="text-slate-500 dark:text-slate-400 text-[11px] font-medium inline-flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
                                                        Insufficient ({availableStock})
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-600 dark:text-slate-300 text-[11px] font-medium inline-flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                                                        Ready ({availableStock})
                                                    </span>
                                                )}
                                            </td>

                                            {/* 9. Status Badge */}
                                            <td className="px-4 py-3.5 whitespace-nowrap">
                                                <StatusBadge
                                                    tone={
                                                        isApproved ? 'pink' : isReceived ? 'emerald' : isRejected ? 'rose' : 'amber'
                                                    }
                                                    dot
                                                    size="xs"
                                                >
                                                    {isApproved ? 'Approved (Exporting)' : isReceived ? 'Received / Fulfilled' : isRejected ? 'Rejected' : 'Pending Review'}
                                                </StatusBadge>
                                                {isRejected && req.rejection_reason && (
                                                    <p className="text-[10px] text-rose-500 dark:text-rose-400 mt-1 truncate max-w-[130px]" title={req.rejection_reason}>
                                                        {req.rejection_reason}
                                                    </p>
                                                )}
                                            </td>

                                            {/* 10. Actions */}
                                            <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    {isPending && (
                                                        canManageRequests ? (
                                                            <>
                                                                <CrudActionButton
                                                                    action="approve"
                                                                    variant="neutral"
                                                                    onClick={() => handleApprove(req)}
                                                                    disabled={actionLoadingId === req.id}
                                                                    ariaLabel={`Approve request #${req.request_number || (req.id ? req.id.slice(0, 8) : '')}`}
                                                                    title="Approve request and allocate stock for export"
                                                                />

                                                                <CrudActionButton
                                                                    action="reject"
                                                                    variant="pink"
                                                                    onClick={() => setRejectingRequest(req)}
                                                                    disabled={actionLoadingId === req.id}
                                                                    ariaLabel={`Reject request #${req.request_number || req.id.slice(0, 8)}`}
                                                                    title="Decline request"
                                                                />
                                                            </>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleNotifyAdminExecutive(req)}
                                                                disabled={actionLoadingId === `notify-${req.id}`}
                                                                className={`px-2.5 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1.5 border active:scale-95 transition-all cursor-pointer ${
                                                                    notifiedRequestIds.has(req.id)
                                                                        ? 'bg-amber-500/15 dark:bg-amber-500/25 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 shadow-xs'
                                                                        : 'bg-[#ebf0f7] dark:bg-[#14151e] border-white/80 dark:border-white/[0.06] shadow-[inset_1px_1px_2px_rgba(166,175,195,0.3),inset_-1px_-1px_2px_rgba(255,255,255,0.8)] dark:shadow-[inset_1.5px_1.5px_3px_rgba(0,0,0,0.6)] text-slate-600 dark:text-slate-400 hover:text-amber-600 hover:border-amber-300 dark:hover:border-amber-700'
                                                                }`}
                                                                aria-label={notifiedRequestIds.has(req.id) ? `Send follow-up to Admin and Executive about request #${req.request_number || (req.id ? req.id.slice(0, 8) : '')}` : `Notify Admin and Executive about request #${req.request_number || (req.id ? req.id.slice(0, 8) : '')}`}
                                                                title={notifiedRequestIds.has(req.id) ? "Already notified. Click to send a follow-up reminder to Admin & Executive." : "Notify Admin & Executive to review and take action on this request"}
                                                            >
                                                                {actionLoadingId === `notify-${req.id}` ? (
                                                                    <i className="fas fa-spinner fa-spin text-[10px]" />
                                                                ) : notifiedRequestIds.has(req.id) ? (
                                                                    <RotateCw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                                                                ) : (
                                                                    <Bell className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                                                                )}
                                                                <span>{notifiedRequestIds.has(req.id) ? 'Follow Up' : 'Notify Admin'}</span>
                                                            </button>
                                                        )
                                                    )}

                                                    {isApproved && (
                                                        isInternal ? (
                                                            <CrudActionButton
                                                                action="custom"
                                                                label="Stock Out"
                                                                icon={ArrowUpRight}
                                                                variant="pink"
                                                                onClick={() => onOpenReleaseModal(req)}
                                                                ariaLabel={`Stock Out ${requestedQty} units`}
                                                                title={`Release and Stock Out up to ${requestedQty} units`}
                                                            />
                                                        ) : (
                                                            <span 
                                                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-[#ebf0f7] dark:bg-[#12131b] px-2.5 py-1 rounded-xl border border-white/80 dark:border-white/[0.06] shadow-inner"
                                                                title="Stock is committed for export. Waiting for external system confirmation."
                                                            >
                                                                <PackageCheck className="w-3.5 h-3.5 text-slate-400" />
                                                                <span>Awaiting Receipt</span>
                                                            </span>
                                                        )
                                                    )}

                                                    {isReceived && (
                                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                                                            <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" /> Fulfilled
                                                        </span>
                                                    )}

                                                    {isRejected && (
                                                        <div className="flex items-center gap-2">
                                                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                                                                <XCircle className="w-3.5 h-3.5 text-slate-400" /> Declined
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleNotifyAdminExecutive(req)}
                                                                disabled={actionLoadingId === `notify-${req.id}`}
                                                                className={`px-2.5 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1.5 border active:scale-95 transition-all cursor-pointer ${
                                                                    notifiedRequestIds.has(req.id)
                                                                        ? 'bg-amber-500/15 dark:bg-amber-500/25 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 shadow-xs'
                                                                        : 'bg-[#ebf0f7] dark:bg-[#14151e] border-white/80 dark:border-white/[0.06] shadow-[inset_1px_1px_2px_rgba(166,175,195,0.3),inset_-1px_-1px_2px_rgba(255,255,255,0.8)] dark:shadow-[inset_1.5px_1.5px_3px_rgba(0,0,0,0.6)] text-slate-600 dark:text-slate-400 hover:text-amber-600 hover:border-amber-300 dark:hover:border-amber-700'
                                                                }`}
                                                                aria-label={notifiedRequestIds.has(req.id) ? `Send follow-up to Admin and Executive about rejected request #${req.request_number || (req.id ? req.id.slice(0, 8) : '')}` : `Notify Admin and Executive about rejected request #${req.request_number || (req.id ? req.id.slice(0, 8) : '')}`}
                                                                title={notifiedRequestIds.has(req.id) ? "Already notified. Click to send a follow-up reminder to Admin & Executive." : "Notify Admin & Executive about this rejected request"}
                                                            >
                                                                {actionLoadingId === `notify-${req.id}` ? (
                                                                    <i className="fas fa-spinner fa-spin text-[10px]" />
                                                                ) : notifiedRequestIds.has(req.id) ? (
                                                                    <RotateCw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                                                                ) : (
                                                                    <Bell className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                                                                )}
                                                                <span>{notifiedRequestIds.has(req.id) ? 'Follow Up' : 'Notify Admin'}</span>
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="flex-shrink-0 p-4 border-t border-slate-200/60 dark:border-white/[0.06] bg-[#ebf0f7]/70 dark:bg-[#14151e]/60 backdrop-blur-md flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Showing <span className="font-extrabold text-slate-900 dark:text-slate-100">{startIndex}</span> to{' '}
                        <span className="font-extrabold text-slate-900 dark:text-slate-100">{endIndex}</span> of{' '}
                        <span className="font-extrabold text-slate-900 dark:text-slate-100">{totalRequests}</span> requests
                    </span>
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={onPageChange}
                    />
                </div>
            </div>

            {/* Rejection Modal */}
            {rejectingRequest && (
                <Portal>
                    <div
                        className="fixed inset-0 bg-slate-950/70 dark:bg-black/80 backdrop-blur-sm z-[120] flex items-center justify-center p-4 animate-in fade-in duration-200"
                        onClick={() => setRejectingRequest(null)}
                    >
                        <div
                            className="relative w-full max-w-md bg-[#f0f3f8] dark:bg-[#161722] rounded-3xl border border-white/90 dark:border-white/[0.08] overflow-hidden transition-all my-auto p-5 sm:p-6 space-y-4"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-600 flex items-center justify-center">
                                    <XCircle className="w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
                                        Reject Request #{rejectingRequest.request_number}
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Item: {rejectingRequest.item_name}
                                    </p>
                                </div>
                            </div>

                            <form onSubmit={handleConfirmReject} className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                                        Reason for Rejection <span className="text-pink-500">*</span>
                                    </label>
                                    <textarea
                                        value={rejectionReason}
                                        onChange={(e) => setRejectionReason(e.target.value)}
                                        rows={3}
                                        placeholder="e.g., Out of stock / Discontinued / Exceeded department quota..."
                                        className="w-full bg-[#ebf0f7] dark:bg-[#12131b] border border-white/80 dark:border-white/[0.06] rounded-2xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 shadow-[inset_1.5px_1.5px_3px_rgba(166,175,195,0.35),inset_-1.5px_-1.5px_3px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.6)] focus:outline-none focus:border-rose-500 resize-none"
                                        required
                                    />
                                </div>

                                <div className="p-2.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/40 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
                                    <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                                    <span className="text-[11px] text-amber-700/90 dark:text-amber-300/90">
                                        Admin & Executive will automatically receive a notification regarding this declined requisition.
                                    </span>
                                </div>

                                <div className="flex items-center justify-end gap-3 pt-2">
                                    <AppButton type="button" variant="secondary" size="md" onClick={() => setRejectingRequest(null)}>
                                        Cancel
                                    </AppButton>
                                    <AppButton
                                        type="submit"
                                        variant="pink"
                                        size="md"
                                    >
                                        Confirm Rejection
                                    </AppButton>
                                </div>
                            </form>
                        </div>
                    </div>
                </Portal>
            )}

            {/* Bulk Rejection Modal */}
            {showBulkRejectModal && (
                <Portal>
                    <div
                        className="fixed inset-0 bg-slate-950/70 dark:bg-black/80 backdrop-blur-sm z-[120] flex items-center justify-center p-4 animate-in fade-in duration-200"
                        onClick={() => setShowBulkRejectModal(false)}
                    >
                        <div
                            className="relative w-full max-w-md bg-[#f0f3f8] dark:bg-[#161722] rounded-3xl border border-white/90 dark:border-white/[0.08] overflow-hidden transition-all my-auto p-5 sm:p-6 space-y-4"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-600 flex items-center justify-center">
                                    <XCircle className="w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
                                        Bulk Reject Requests
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Rejecting {requests.filter(r => selectedIds.has(r.id) && (r.status || 'pending').toLowerCase() === 'pending').length} pending request(s)
                                    </p>
                                </div>
                            </div>

                            <form onSubmit={handleConfirmBulkReject} className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                                        Reason for Bulk Rejection <span className="text-pink-500">*</span>
                                    </label>
                                    <textarea
                                        value={bulkRejectReason}
                                        onChange={(e) => setBulkRejectReason(e.target.value)}
                                        rows={3}
                                        placeholder="e.g., Exceeded department budget / Inventory unavailable / Batch cancellation..."
                                        className="w-full bg-[#ebf0f7] dark:bg-[#12131b] border border-white/80 dark:border-white/[0.06] rounded-2xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 shadow-[inset_1.5px_1.5px_3px_rgba(166,175,195,0.35),inset_-1.5px_-1.5px_3px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.6)] focus:outline-none focus:border-rose-500 resize-none"
                                        required
                                    />
                                </div>

                                <div className="p-2.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/40 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
                                    <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                                    <span className="text-[11px] text-amber-700/90 dark:text-amber-300/90">
                                        Admin & Executive will automatically receive a batch notification regarding these declined requisitions.
                                    </span>
                                </div>

                                <div className="flex items-center justify-end gap-3 pt-2">
                                    <AppButton type="button" variant="secondary" size="md" onClick={() => setShowBulkRejectModal(false)}>
                                        Cancel
                                    </AppButton>
                                    <AppButton
                                        type="submit"
                                        variant="pink"
                                        size="md"
                                    >
                                        Confirm Bulk Rejection
                                    </AppButton>
                                </div>
                            </form>
                        </div>
                    </div>
                </Portal>
            )}
        </div>
    );
});
