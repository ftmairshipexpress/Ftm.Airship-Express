import React, { useState } from 'react';
import { X, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { apiFetch } from '../../lib/apiFetch';
import type { Employee, OverrideReason } from '../../types/workforce';

interface ManualAttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: Employee[];
  onSuccess: () => void;
}

export function ManualAttendanceModal({ isOpen, onClose, profiles, onSuccess }: ManualAttendanceModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [employeeId, setEmployeeId] = useState('');
  const [action, setAction] = useState<'Clock In' | 'Clock Out'>('Clock In');
  const [reason, setReason] = useState<OverrideReason | ''>('');
  const [notes, setNotes] = useState('');
  
  // Default to current local time, formatted for datetime-local
  const getLocalISOString = () => {
    const tzoffset = (new Date()).getTimezoneOffset() * 60000;
    return (new Date(Date.now() - tzoffset)).toISOString().slice(0, 16);
  };
  const [punchTime, setPunchTime] = useState(getLocalISOString());

  if (!isOpen) return null;

  const selectedEmp = profiles.find(p => p.id === employeeId);
  const isRfidMissing = selectedEmp && !selectedEmp.rfid_uid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (isRfidMissing) {
      setError('Employee must have a registered RFID tag before manual bypass can be used.');
      setLoading(false);
      return;
    }

    if (notes.trim().length < 15) {
      setError('Please provide at least 15 characters of detailed context.');
      setLoading(false);
      return;
    }

    try {
      // Ensure punchTime is formatted to a full ISO string (UTC)
      const punchDate = new Date(punchTime);

      const payload = {
        employee_id: employeeId,
        action,
        punch_time: punchDate.toISOString(),
        manual_override_reason: reason,
        manual_override_notes: notes,
      };

      await apiFetch('/api/attendance/manual', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      
      onSuccess();
      onClose();
      setEmployeeId('');
      setAction('Clock In');
      setReason('');
      setNotes('');
      setPunchTime(getLocalISOString());
    } catch (err: any) {
      setError(err.message || 'Failed to submit manual attendance');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/20 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative w-full max-w-lg bg-paper p-6 shadow-xl animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-ink">Manual Attendance Entry</h2>
            <p className="text-xs text-muted mt-1">Bypass hardware scanner with audited manual override</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-ink/5 rounded-full text-muted hover:text-ink transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-start gap-2 text-rose-600 text-sm">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
          
          {isRfidMissing && !error && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-2 text-amber-600 text-sm">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <p>Employee must have a registered RFID tag before manual bypass can be used.</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Employee</label>
            <select
              required
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full bg-paper border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
            >
              <option value="">Select Employee...</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.full_name} ({p.department})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Action</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAction('Clock In')}
                  className={`py-2 px-3 text-sm font-semibold rounded-xl border transition-colors ${
                    action === 'Clock In' 
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600' 
                      : 'bg-paper border-line text-muted hover:bg-ink/5'
                  }`}
                >
                  Clock In
                </button>
                <button
                  type="button"
                  onClick={() => setAction('Clock Out')}
                  className={`py-2 px-3 text-sm font-semibold rounded-xl border transition-colors ${
                    action === 'Clock Out' 
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-600' 
                      : 'bg-paper border-line text-muted hover:bg-ink/5'
                  }`}
                >
                  Clock Out
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Actual Punch Time</label>
              <input
                type="datetime-local"
                required
                value={punchTime}
                onChange={(e) => setPunchTime(e.target.value)}
                className="w-full bg-paper border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Override Reason</label>
            <select
              required
              value={reason}
              onChange={(e) => setReason(e.target.value as OverrideReason)}
              className="w-full bg-paper border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent"
            >
              <option value="">Select documented reason...</option>
              <option value="HARDWARE_OFFLINE">RFID is not connecting properly to the system</option>
              <option value="NETWORK_LATENCY">The internet is having issues</option>
              <option value="LOST_BADGE">Employee ID is lost / forgotten</option>
              <option value="MAINTENANCE">RFID scanner is on maintenance mode</option>
              <option value="OTHER">Other exception</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5 flex justify-between">
              <span>Detailed Explanation</span>
              <span className={notes.length < 15 ? 'text-rose-500' : 'text-emerald-500'}>
                {notes.length}/15 chars min
              </span>
            </label>
            <textarea
              required
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Provide specific context for this manual override to satisfy HR audit requirements..."
              className="w-full bg-paper border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent min-h-[80px] resize-none"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading || notes.trim().length < 15 || !reason || !employeeId || isRfidMissing}>
              {loading ? 'Submitting...' : 'Submit Override'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
