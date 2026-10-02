'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../lib/apiFetch';
import { ExportPrintDropdown } from '../../components/ui/ExportPrintDropdown';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { LeaveRequestReviewModal } from '../../components/modals/LeaveRequestReviewModal';
import { LeaveRequestModal } from '../../components/modals/LeaveRequestModal';
import { Button } from '../../components/ui/Button';
import { Search, Inbox, Plus } from 'lucide-react';

export default function LeavePage() {
  const [filter, setFilter] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [employees, setEmployees] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [allEmployees, setAllEmployees] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [bals, reqs, drvs] = await Promise.all([
        apiFetch<any[]>('/api/leave/balances').catch(() => []),
        apiFetch<any[]>('/api/leave/requests').catch(() => []),
        apiFetch<any[]>('/api/drivers').catch(() => []),
      ]);
      setEmployees(Array.isArray(bals) ? bals : []);
      setAllEmployees(Array.isArray(drvs) ? drvs : []);
      // Only show pending requests
      const allReqs = Array.isArray(reqs) ? reqs : [];
      setPendingRequests(allReqs.filter((r: any) => r.status === 'Pending HR Review'));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredEmployees = employees.filter(e =>
    (e.full_name || '').toLowerCase().includes(filter.toLowerCase())
  );

  const leaveTypeColor = (type: string) => {
    if (type === 'Sick') return 'bg-rose-500/10 text-rose-500';
    if (type === 'Vacation') return 'bg-sky-500/10 text-sky-500';
    if (type === 'Maternity' || type === 'Paternity') return 'bg-violet-500/10 text-violet-500';
    if (type === 'Bereavement') return 'bg-slate-500/10 text-slate-400';
    return 'bg-amber-500/10 text-amber-500';
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-paper p-5 rounded-2xl border border-line shadow-sm mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Leave & Fatigue Rest Management</h1>
          <p className="text-xs text-muted mt-1">Track employee leave balances and review pending requests.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportPrintDropdown />
          <Button onClick={() => setCreateModalOpen(true)} variant="primary">
            <Plus size={16} />
            File Leave Request
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Col: Pending Requests Queue */}
        <div className="lg:col-span-1 space-y-4">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Inbox size={16} className="text-accent" />
            Action Required ({pendingRequests.length})
          </h2>
          <div className="space-y-3">
            {loading && (
              <p className="text-xs text-muted">Loading...</p>
            )}
            {!loading && pendingRequests.length === 0 && (
              <p className="text-xs text-muted">No pending requests.</p>
            )}
            {pendingRequests.map(req => {
              const empName = req.employee?.full_name || 'Unknown Employee';
              const empRole = req.employee?.role || req.employee?.department || 'Staff';
              return (
                <div
                  key={req.id}
                  onClick={() => setSelectedRequest(req)}
                  className="bg-paper p-4 rounded-xl border border-line shadow-2xs hover:border-accent/50 cursor-pointer transition-colors"
                >
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="text-sm font-semibold text-ink">{empName}</h3>
                    <span className="text-[10px] font-medium bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full">Pending</span>
                  </div>
                  <p className="text-xs text-muted mb-1">{empRole}</p>
                  <p className="text-xs text-ink font-medium">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold mr-1 ${leaveTypeColor(req.leave_type)}`}>{req.leave_type}</span>
                    {req.days_count} day{req.days_count !== 1 ? 's' : ''} &bull; {req.start_date} → {req.end_date}
                  </p>
                  {req.reason && <p className="text-[10px] text-muted mt-1 truncate">{req.reason}</p>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Col: Employee Balances */}
        <div className="lg:col-span-2">
          <div className="bg-paper p-5 rounded-2xl border border-line shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
              <h2 className="text-sm font-semibold text-ink">Employee Leave Balances</h2>
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder="Search employees..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="text-xs bg-ink/[0.03] dark:bg-paper/[0.05] border border-line rounded-xl pl-9 pr-3 py-2 text-ink placeholder:text-muted focus:outline-none focus:border-accent w-full transition-all"
                />
              </div>
            </div>

            <Table>
              <THead>
                <TR header>
                  <TH>Employee</TH>
                  <TH>Role</TH>
                  <TH>Sick Leave</TH>
                  <TH>Vacation Leave</TH>
                </TR>
              </THead>
              <TBody>
                {loading && (
                  <TR><TD colSpan={4} className="text-center text-xs text-muted py-6">Loading balances...</TD></TR>
                )}
                {!loading && filteredEmployees.length === 0 && (
                  <TR><TD colSpan={4} className="text-center text-xs text-muted py-6">No employee records found.</TD></TR>
                )}
                {filteredEmployees.map((emp) => {
                  const sickRemaining = (emp.sick_total ?? 15) - (emp.sick_used ?? 0);
                  const vacRemaining = (emp.vacation_total ?? 15) - (emp.vacation_used ?? 0);
                  return (
                    <TR key={emp.id}>
                      <TD className="font-semibold text-ink">{emp.full_name}</TD>
                      <TD className="text-muted">{emp.role}</TD>
                      <TD>
                        <span className={`text-xs font-medium ${sickRemaining < 3 ? 'text-rose-500' : 'text-emerald-500'}`}>
                          {sickRemaining}/{emp.sick_total ?? 15} days
                        </span>
                      </TD>
                      <TD>
                        <span className={`text-xs font-medium ${vacRemaining < 3 ? 'text-rose-500' : 'text-emerald-500'}`}>
                          {vacRemaining}/{emp.vacation_total ?? 15} days
                        </span>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        </div>
      </div>

      <LeaveRequestReviewModal
        isOpen={!!selectedRequest}
        onClose={() => { setSelectedRequest(null); loadData(); }}
        request={selectedRequest}
      />

      <LeaveRequestModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        employees={allEmployees}
        onSubmit={async (payload) => {
          await apiFetch('/api/leave', { method: 'POST', body: JSON.stringify(payload) });
          await loadData();
          setCreateModalOpen(false);
        }}
      />
    </>
  );
}
