'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/apiFetch';
import { ExportPrintDropdown } from '../../components/ui/ExportPrintDropdown';
import { Table, THead, TBody, TR, TH, TD } from '../../components/ui/Table';
import { Sparkles, BarChart2, Check, AlertTriangle, X } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function TimesheetsPage() {
  const [filter, setFilter] = useState('');
  const [timesheets, setTimesheets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiState, setAiState] = useState<'idle' | 'generating' | 'done'>('idle');

  useEffect(() => {
    async function loadData() {
      try {
        const data = await apiFetch<any[]>('/api/timesheets').catch(() => []);
        setTimesheets(data || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);



  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const updated = await apiFetch<any>('/api/timesheets', {
        method: 'PATCH',
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (updated && updated.data) {
        setTimesheets(prev => prev.map(t => t.id === id ? updated.data : t));
      } else {
        // Optimistic update fallback if API returns void due to simulation
        setTimesheets(prev => prev.map(t => t.id === id ? { ...t, status: newStatus } : t));
      }
    } catch (e) {
      console.error(e);
      // Optimistic update
      setTimesheets(prev => prev.map(t => t.id === id ? { ...t, status: newStatus } : t));
    }
  };

  const handleRequestInsights = () => {
    setAiState('generating');
    // Mocking the AI generation delay for now until the backend is built
    setTimeout(() => {
      setAiState('done');
    }, 4000);
  };

  
  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      await fetch('/workforce-management-dashboard/api/timesheets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus })
      });
      // Update local state instantly
      setTimesheets(prev => prev.map(t => t.id === id ? { ...t, status: newStatus } : t));
    } catch (e) {
      console.error(e);
      alert("Failed to update status");
    }
  };

  const chartData = timesheets.map(t => ({
    name: t.employee?.full_name?.split(' ')[0] || 'Unknown',
    totalHours: parseFloat(t.total_hours || '0'),
    overtime: Math.max(0, parseFloat(t.total_hours || '0') - 8), // simple overtime mock
  }));

  const filteredTimesheets = timesheets.filter(t => t.employee?.full_name?.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-paper p-5 rounded-2xl border border-line shadow-sm mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Timesheet Workflow</h1>
          <p className="text-xs text-muted mt-1">
            Review tracked hours, overtime, and approve timesheets for payroll.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportPrintDropdown />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Chart Column */}
        <div className="lg:col-span-2 bg-paper p-5 rounded-2xl border border-line shadow-sm">
          <div className="flex items-center gap-2 mb-4 border-b border-line pb-4">
            <BarChart2 size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-ink">Total Hours by Employee</h2>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)' }} contentStyle={{ borderRadius: '8px', border: '1px solid #eaeaea' }} />
                <Bar dataKey="totalHours" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.overtime > 10 ? '#ef4444' : '#3b82f6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center mt-2 gap-4 text-[10px] text-muted">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Standard</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> High Overtime (&gt;10h)</span>
          </div>
        </div>

        {/* AI Insight Column */}
          <div className="lg:col-span-1 bg-gradient-to-b from-ink/5 to-transparent dark:from-paper/10 border border-line rounded-2xl p-5 flex flex-col relative overflow-hidden min-h-[250px]">
            <div className="flex items-center gap-2 mb-4 text-accent">
              <Sparkles size={16} />
              <h2 className="text-sm font-semibold">AI Analytical Insights</h2>
            </div>
            
            {aiState === 'idle' && (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                <BarChart2 size={32} className="text-muted/50 mb-3" />
                <p className="text-xs text-muted mb-4">
                  Run an AI analysis on the current timesheets to detect overtime anomalies, approval bottlenecks, and staffing trends.
                </p>
                <button 
                  onClick={handleRequestInsights}
                  className="bg-accent text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-sm hover:bg-accent/90 transition-all flex items-center gap-2"
                >
                  <Sparkles size={14} /> Request Insights
                </button>
              </div>
            )}

            {aiState === 'generating' && (
              <>
                <div className="flex-1 space-y-4 pt-2">
                  <div className="space-y-2">
                    <div className="h-3 bg-line/50 rounded-full w-3/4 animate-pulse" />
                    <div className="h-3 bg-line/50 rounded-full w-full animate-pulse" />
                    <div className="h-3 bg-line/50 rounded-full w-5/6 animate-pulse" />
                  </div>
                  <div className="p-3 bg-paper/50 rounded-xl border border-line/50">
                    <div className="h-2.5 bg-line/50 rounded-full w-1/2 mb-2 animate-pulse" />
                    <div className="h-6 bg-line/50 rounded-lg w-1/4 animate-pulse" />
                  </div>
                  <div className="space-y-2 mt-4">
                    <div className="h-3 bg-line/50 rounded-full w-full animate-pulse" />
                    <div className="h-3 bg-line/50 rounded-full w-2/3 animate-pulse" />
                  </div>
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-paper via-transparent to-transparent z-10 flex items-end justify-center pb-6 pointer-events-none">
                  <span className="text-xs font-medium text-accent bg-paper px-3 py-1 rounded-full shadow-sm border border-accent/20 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-ping" /> Analyzing Patterns...
                  </span>
                </div>
              </>
            )}

            {aiState === 'done' && (
              <div className="flex-1 flex flex-col pt-2 text-sm text-ink/80">
                <p className="mb-3 text-xs leading-relaxed">
                  <strong className="text-ink">Pattern Detected:</strong> High overtime accumulation observed in Operations. 
                  Consider shifting schedule distributions to offset the 15% increase in late clock-outs.
                </p>
                <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-xs">
                  <span className="font-semibold text-amber-600">Pending Implementation</span>
                  <p className="text-amber-600/80 mt-1">Live Gemini AI integration is scheduled for the final roadmap phase.</p>
                </div>
                <div className="mt-auto pt-4 flex justify-end">
                  <button onClick={() => setAiState('idle')} className="text-[10px] text-muted hover:text-ink transition-colors">
                    Reset Module
                  </button>
                </div>
              </div>
            )}
          </div>
      </div>

      <div className="bg-paper p-5 rounded-2xl border border-line shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
          <h2 className="text-sm font-semibold text-ink">Recent Timesheets</h2>
          <input
            type="text"
            placeholder="Search employees..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs bg-ink/[0.03] dark:bg-paper/[0.05] border border-line rounded-xl px-3 py-2 text-ink placeholder:text-muted focus:outline-none focus:border-accent w-full sm:w-64 transition-all"
          />
        </div>

        <Table>
          <THead>
            <TR header>
              <TH>Employee</TH><TH>Role</TH><TH>Regular Hours</TH><TH>Overtime</TH><TH>Status</TH><TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filteredTimesheets.map((t) => (
              <TR key={t.id}>
                <TD className="font-semibold text-ink">{t.employee?.full_name || 'Unknown'}</TD>
                <TD className="text-muted">{t.employee?.role || 'Staff'}</TD>
                <TD className="font-mono text-xs">{t.total_hours || '0'}h</TD>
                <TD className="font-mono text-xs text-rose-500">{Math.max(0, parseFloat(t.total_hours || '0') - 8)}h</TD>
                <TD>
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${
                    t.status === 'Approved' ? 'bg-emerald-500/10 text-emerald-600' :
                    t.status === 'Flagged' ? 'bg-rose-500/10 text-rose-600' :
                    'bg-amber-500/10 text-amber-600'
                  }`}>
                    {t.status}
                  </span>
                </TD>
                  <TD className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {t.status !== 'Approved' && (
                        <button 
                          onClick={() => handleUpdateStatus(t.id, 'Approved')}
                          className="text-[10px] font-bold bg-emerald-500 hover:bg-emerald-600 text-white px-2 py-1 rounded transition-colors"
                        >
                          Approve
                        </button>
                      )}
                      {t.status !== 'Flagged' && (
                        <button 
                          onClick={() => handleUpdateStatus(t.id, 'Flagged')}
                          className="text-[10px] font-bold bg-rose-500 hover:bg-rose-600 text-white px-2 py-1 rounded transition-colors"
                        >
                          Flag
                        </button>
                      )}
                    </div>
                  </TD>
                </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </>
  );
}

