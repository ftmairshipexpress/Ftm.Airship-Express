'use client';

import React from 'react';
import { X, Check, ShieldAlert } from 'lucide-react';
import { approveLeaveRequest, rejectLeaveRequest } from '../../actions/leaveActions';
import { useState } from 'react';

interface LeaveRequestReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: any;
}

export function LeaveRequestReviewModal({ isOpen, onClose, request }: LeaveRequestReviewModalProps) {
  const [loading, setLoading] = useState(false);
  if (!isOpen || !request) return null;

  const empName = request.employee?.full_name || 'Unknown Employee';
  const empRole = request.employee?.role || request.employee?.department || 'Staff';
  const leaveType = request.leave_type || 'Leave';
  const daysCount = request.days_count || 1;
  const startDate = request.start_date || '';
  const endDate = request.end_date || '';
  const reason = request.reason || 'No reason provided.';
  const balanceRemaining = request.balance_remaining ?? '—';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-paper text-ink rounded-3xl border border-line shadow-2xl w-full max-w-lg p-6 flex flex-col gap-5 animate-modal">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <h3 className="text-lg font-bold text-ink">Review Leave Request</h3>
            <p className="text-xs text-muted mt-1">Approve or reject the request below.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full text-muted hover:bg-line/50 hover:text-ink transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Employee Info */}
        <div className="p-4 rounded-xl bg-ink/5 dark:bg-paper/5 border border-line space-y-3">
          <div>
            <p className="text-sm font-semibold text-ink">{empName}</p>
            <p className="text-xs text-muted">{empRole}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-line/50">
            <div>
              <span className="text-muted block">Leave Type</span>
              <span className="font-semibold text-ink">{leaveType} Leave</span>
            </div>
            <div>
              <span className="text-muted block">Duration</span>
              <span className="font-semibold text-ink">{daysCount} day{daysCount !== 1 ? 's' : ''}</span>
            </div>
            <div>
              <span className="text-muted block">Start Date</span>
              <span className="font-semibold text-ink">{startDate}</span>
            </div>
            <div>
              <span className="text-muted block">End Date</span>
              <span className="font-semibold text-ink">{endDate}</span>
            </div>
          </div>
          {reason && (
            <div className="pt-2 border-t border-line/50 text-xs">
              <span className="text-muted block mb-0.5">Reason</span>
              <span className="text-ink">{reason}</span>
            </div>
          )}
        </div>

        {/* Warning */}
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-start gap-2">
          <ShieldAlert size={15} className="mt-0.5 shrink-0" />
          <p className="text-xs font-medium">
            Approving will reduce available workforce for {daysCount} day{daysCount !== 1 ? 's' : ''} and deduct from the employee's {leaveType} leave balance.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t border-line/50">
          <button
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              await rejectLeaveRequest(request.id);
              setLoading(false);
              onClose();
            }}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-rose-500/10 text-rose-500 rounded-xl text-sm font-semibold hover:bg-rose-500/20 transition-colors disabled:opacity-50"
          >
            <X size={15} /> Reject
          </button>
          <button
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              await approveLeaveRequest(
                request.id,
                request.employee_id,
                request.leave_type,
                request.days_count
              );
              setLoading(false);
              onClose();
            }}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-50"
          >
            <Check size={15} /> {loading ? 'Processing...' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}
