import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { LEAVE_TYPES } from '../../utils/constants';
import type { CreateLeavePayload } from '../../types/api';

interface LeaveRequestModalProps {
 open: boolean;
 onClose: () => void;
 onSubmit: (payload: any) => Promise<void>;
 employees?: any[];
}

/**
 * Form modal for submitting a leave request. Employees request leave for
 * themselves; HR Admin then approves/rejects. Submits to POST /api/leave.
 */
export function LeaveRequestModal({ open, onClose, onSubmit, employees = [] }: LeaveRequestModalProps) {
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);

 const [form, setForm] = useState<any>({
 employee_id: '',
 leave_type: 'Vacation',
 start_date: new Date().toISOString().split('T')[0],
 end_date: new Date().toISOString().split('T')[0],
 reason: '',
 });

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 setLoading(true);
 setError(null);
 try {
 await onSubmit(form);
 // Reset on success
 setForm({
 employee_id: '',
 leave_type: 'Vacation',
 start_date: new Date().toISOString().split('T')[0],
 end_date: new Date().toISOString().split('T')[0],
 reason: '',
 });
 onClose();
 } catch (err) {
 setError(err instanceof Error ? err.message : 'Failed to request leave');
 } finally {
 setLoading(false);
 }
 };

 return (
 <Modal
 open={open}
 onClose={onClose}
 title="Request Leave / Fatigue Rest"
 icon={<Plus size={20} />}
 >
 <form onSubmit={handleSubmit} className="space-y-3 text-xs">
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl text-xs text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}

        <div>
          <label className="font-medium text-xs text-muted block mb-1">Filing for Employee</label>
          <select
            required
            value={form.employee_id}
            onChange={e => setForm({ ...form, employee_id: e.target.value })}
            className="w-full bg-ink/[0.03] dark:bg-paper/[0.05] border border-line rounded-xl p-2.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all"
          >
            <option value="" disabled className="text-ink bg-white dark:bg-paper">-- Select an Employee --</option>
            {employees.map((emp: any) => (
              <option key={emp.id} value={emp.id} className="text-ink bg-white dark:bg-paper">
                {emp.full_name || 'Unnamed'} ({emp.role || 'Staff'})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="font-medium text-xs text-muted block mb-1">Leave Type</label>
          <select
            value={form.leave_type}
            onChange={(e) => setForm({ ...form, leave_type: e.target.value })}
            className="w-full bg-ink/[0.03] dark:bg-paper/[0.05] border border-line rounded-xl p-2.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all"
          >
            {['Vacation', 'Sick', 'Maternity', 'Paternity', 'Bereavement', 'Unpaid'].map(t => (
              <option key={t} value={t} className="text-ink bg-white dark:bg-paper">{t} Leave</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="font-medium text-xs text-muted block mb-1">Start Date</label>
            <input
              type="date"
              required
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              className="w-full bg-ink/[0.03] dark:bg-paper/[0.05] border border-line rounded-xl p-2.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all"
            />
          </div>
          <div>
            <label className="font-medium text-xs text-muted block mb-1">End Date</label>
            <input
              type="date"
              required
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              className="w-full bg-ink/[0.03] dark:bg-paper/[0.05] border border-line rounded-xl p-2.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all"
            />
          </div>
        </div>

        <div>
          <label className="font-medium text-xs text-muted block mb-1">Reason (optional)</label>
          <textarea
            rows={3}
            placeholder="Optional details for the HR Admin..."
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            className="w-full bg-ink/[0.03] dark:bg-paper/[0.05] border border-line rounded-xl p-2.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all resize-none"
          />
        </div>

        <div className="pt-2 flex justify-end gap-2 border-t border-line/50 mt-4">
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={loading}>
            {loading ? 'Submitting...' : 'Submit'}
          </Button>
        </div>
</form>
 </Modal>
 );
}
