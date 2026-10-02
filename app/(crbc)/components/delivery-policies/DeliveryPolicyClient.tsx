"use client";

import { useState } from "react";
import { Plus, RefreshCw, Trash2, Pencil, Check, X } from "lucide-react";
import { createDeliveryPolicy, SLA_TIERS } from "../../services/delivery-policy";
import { DeliveryPolicy } from "../../types/delivery-policy";
import type { SlaTier } from "../../types/sla";
import { toast } from "sonner";

function formatDelivery(minDays: number, maxDays: number) {
  return minDays === maxDays ? `${minDays} days` : `${minDays}–${maxDays} days`;
}

export default function DeliveryPolicyClient({ Policies }: { Policies: DeliveryPolicy[] }) {
  const [policies, setPolicies] = useState<DeliveryPolicy[]>(Policies);
  const [policy, setPolicy] = useState("");
  const [coverage, setCoverage] = useState("");
  const [region, setRegion] = useState<SlaTier | "">("");
  const [minDays, setMinDays] = useState("");
  const [maxDays, setMaxDays] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmTarget = policies.find((p) => p.id === confirmDeleteId);
  const [editForm, setEditForm] = useState({ policy: "", coverage: "", region: "" as SlaTier | "", minDays: "", maxDays: "" });
  const [isSaving, setIsSaving] = useState(false);

  function startEdit(p: DeliveryPolicy) {
    setEditingId(p.id);
    setEditForm({ policy: p.policy, coverage: p.coverage, region: p.region ?? "", minDays: String(p.minDays), maxDays: String(p.maxDays) });
  }

  async function handleEdit(id: string) {
    setIsSaving(true);
    try {
      const res = await fetch("/api/deliverypolicy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...editForm, minDays: Number(editForm.minDays), maxDays: Number(editForm.maxDays) }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setPolicies((prev) => prev.map((p) => p.id === id ? updated : p));
      setEditingId(null);
      toast.success("Delivery policy updated successfully.");
    } catch {
      toast.error("Failed to update policy.");
    } finally {
      setIsSaving(false);
    }
  }

  async function fetchPolicies() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/deliverypolicy");
      const data = await res.json();
      setPolicies(data);
      toast.success("Policies refreshed.");
    } catch {
      toast.error("Failed to refresh policies.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch("/api/deliverypolicy", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error();
      setPolicies((prev) => prev.filter((p) => p.id !== id));
      setConfirmDeleteId(null);
      toast.success("Delivery policy deleted successfully.");
    } catch {
      toast.error("Failed to delete policy.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // The tier is what SLA evaluation keys on. Without it the row would be
    // invisible to the SLA lookup, so it is required before submitting.
    if (!region) {
      setError("Region is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const newPolicy = await createDeliveryPolicy({
        policy,
        coverage,
        region,
        minDays: Number(minDays),
        maxDays: Number(maxDays),
      });
      setPolicy("");
      setCoverage("");
      setRegion("");
      setMinDays("");
      setMaxDays("");
      setPolicies((prev) => [...prev, newPolicy]);
      toast.success("Delivery policy created successfully.");

    } catch (err: unknown) {
         toast.error(
      err instanceof Error ? err.message : "Failed to create delivery policy."
    );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="w-full min-h-screen p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-foreground text-xl font-semibold">Delivery Policies</h1>
          <p className="text-sm text-muted mt-0.5">Manage your delivery policies.</p>
        </div>

        <div className="bg-background border border-line rounded-xl p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-red-700 bg-red-50 border border-red-200 dark:text-red-400 dark:bg-red-950 dark:border-red-900 rounded-lg text-sm px-3 py-2">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Policy Name</label>
                <input
                  value={policy}
                  onChange={(e) => setPolicy(e.target.value)}
                  placeholder="e.g. Normal Delivery"
                  className="w-full text-sm px-3 py-2 rounded-lg border border-line bg-background text-foreground placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-accent/15 focus:border-accent"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Coverage</label>
                <input
                  value={coverage}
                  onChange={(e) => setCoverage(e.target.value)}
                  placeholder="e.g. Metro Manila"
                  className="w-full text-sm px-3 py-2 rounded-lg border border-line bg-background text-foreground placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-accent/15 focus:border-accent"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Region Tier</label>
              <p className="text-[11px] text-muted">
                The SLA tier this policy applies to. Metro Manila covers the NCR
                and all of its district naming variants. Province covers every
                destination outside it, including nearby provinces such as
                Cavite, Rizal, Bulacan and Laguna.
              </p>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value as SlaTier | "")}
                className="w-full max-w-xs text-sm px-3 py-2 rounded-lg border border-line bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent/15 focus:border-accent"
                required
              >
                <option value="">Select a region…</option>
                {SLA_TIERS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Expected Delivery</label>
              <div className="flex items-center gap-2 max-w-xs">
                <input
                  type="number" min={1} value={minDays}
                  onChange={(e) => setMinDays(e.target.value)}
                  placeholder="Min"
                  className="w-full text-sm px-3 py-2 rounded-lg border border-line bg-background text-foreground placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-accent/15 focus:border-accent"
                  required
                />
                <span className="text-muted/50 text-sm shrink-0">–</span>
                <input
                  type="number" min={1} value={maxDays}
                  onChange={(e) => setMaxDays(e.target.value)}
                  placeholder="Max"
                  className="w-full text-sm px-3 py-2 rounded-lg border border-line bg-background text-foreground placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-accent/15 focus:border-accent"
                  required
                />
                <span className="text-muted/60 text-xs shrink-0">days</span>
              </div>
            </div>

            <button
              type="submit" disabled={isSubmitting}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-accent text-sm font-medium text-white hover:bg-accent-dark transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={15} />
              {isSubmitting ? "Creating..." : "Create Policy"}
            </button>
          </form>
        </div>

        <div className="bg-background border border-line rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="text-sm font-medium text-muted">{policies.length} policies</span>
            <button
              onClick={fetchPolicies}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
            >
              <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Policy", "Coverage", "Region", "Expected Delivery", "Action"].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium text-xs text-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted text-sm">Loading...</td></tr>
              )}
              {!isLoading && policies.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted text-sm">No policies yet — create one above.</td></tr>
              )}
              {!isLoading && policies.map((p) => (
                <tr key={p.id} className="border-b border-line/60 last:border-0 hover:bg-accent/5 transition-colors">
                  {editingId === p.id ? (
                    <>
                      <td className="px-3 py-2">
                        <input value={editForm.policy} onChange={(e) => setEditForm({ ...editForm, policy: e.target.value })}
                          className="w-full text-sm px-2 py-1 rounded border border-line bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent/15" />
                      </td>
                      <td className="px-3 py-2">
                        <input value={editForm.coverage} onChange={(e) => setEditForm({ ...editForm, coverage: e.target.value })}
                          className="w-full text-sm px-2 py-1 rounded border border-line bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent/15" />
                      </td>
                      <td className="px-3 py-2">
                        <select value={editForm.region} onChange={(e) => setEditForm({ ...editForm, region: e.target.value as SlaTier | "" })}
                          className="w-full text-sm px-2 py-1 rounded border border-line bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent/15">
                          <option value="">Select…</option>
                          {SLA_TIERS.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <input type="number" min={1} value={editForm.minDays} onChange={(e) => setEditForm({ ...editForm, minDays: e.target.value })}
                            className="w-16 text-sm px-2 py-1 rounded border border-line bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent/15" />
                          <span className="text-muted/50">–</span>
                          <input type="number" min={1} value={editForm.maxDays} onChange={(e) => setEditForm({ ...editForm, maxDays: e.target.value })}
                            className="w-16 text-sm px-2 py-1 rounded border border-line bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent/15" />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => handleEdit(p.id)} disabled={isSaving} className="text-emerald-600 hover:text-emerald-500 dark:hover:text-emerald-400 cursor-pointer disabled:opacity-50"><Check size={14} /></button>
                          <button onClick={() => setEditingId(null)} className="text-muted hover:text-foreground transition-colors cursor-pointer"><X size={14} /></button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 font-medium text-accent">{p.policy}</td>
                      <td className="px-4 py-3 text-muted">{p.coverage}</td>
                      <td className="px-4 py-3 text-muted">
                        {p.region ?? (
                          <span
                            className="text-zinc-500"
                            title="No tier — this policy is not used by SLA evaluation"
                          >
                            Not set
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted">{formatDelivery(p.minDays, p.maxDays)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-start gap-6">
                          <button onClick={() => startEdit(p)} className="text-muted hover:text-accent transition-colors cursor-pointer"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDeleteId(p.id)} className="text-muted hover:text-red-500 transition-colors cursor-pointer"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirm Modal */}
      {confirmDeleteId && confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-background border border-line rounded-xl shadow-lg p-6 w-full max-w-sm mx-4">
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">Delete Policy</h2>
              <button onClick={() => setConfirmDeleteId(null)} className="text-muted hover:text-foreground transition-colors cursor-pointer"><X size={16} /></button>
            </div>
            <p className="text-sm text-muted mb-5">
              Are you sure you want to delete <span className="font-medium text-foreground">{confirmTarget.policy}</span>? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-3.5 py-2 rounded-lg text-sm text-muted hover:bg-accent/10 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={!!deletingId}
                className="px-3.5 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                {deletingId ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}