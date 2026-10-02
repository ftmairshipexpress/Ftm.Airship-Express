"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Tooltip } from "@/performance-development-dashboard/components/ui/Tooltip";
import type {
  CycleCreateInput,
  PerformanceCycleFrequency,
  QuarterlyPeriod,
  SemiAnnualPeriod,
} from "@/performance-development-dashboard/types";
import {
  deriveStandardCyclePeriod,
  PERFORMANCE_CYCLE_FREQUENCIES,
  QUARTERLY_PERIODS,
  SEMI_ANNUAL_PERIODS,
} from "@/performance-development-dashboard/types";
import { formatDateOnly } from "@/performance-development-dashboard/lib/format/date";
import { Modal } from "@/performance-development-dashboard/components/ui/Modal";

type Props = {
  onClose: () => void;
  onSubmit: (input: CycleCreateInput) => Promise<void>;
};

const FREQUENCY_LABELS: Record<PerformanceCycleFrequency, string> = {
  quarterly: "Quarterly — 3 Months",
  semi_annual: "Semi-Annual — 6 Months",
  annual: "Annual — 12 Months",
};

const QUARTER_LABELS: Record<QuarterlyPeriod, string> = {
  Q1: "Q1 — January to March",
  Q2: "Q2 — April to June",
  Q3: "Q3 — July to September",
  Q4: "Q4 — October to December",
};

const HALF_LABELS: Record<SemiAnnualPeriod, string> = {
  H1: "H1 — January to June",
  H2: "H2 — July to December",
};

/**
 * Standard performance-cycle creation. HR provides a descriptive Cycle Name
 * plus Year + Review Frequency (+ Period for quarterly/semi-annual; annual
 * needs none). The name is metadata only — the canonical period label and
 * dates are generated (previewed read-only here, derived authoritatively
 * server-side). Descriptive names must be unique, and each canonical period
 * is unique per year — duplicates are rejected by the server with 409.
 *
 * Review frequency belongs to the cycle only; job positions (Goals % vs
 * Competencies %) are independent of cycle length.
 */
export function CreateCycleModal({ onClose, onSubmit }: Props) {
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(
    () => [currentYear - 1, currentYear, currentYear + 1],
    [currentYear]
  );

  const [name, setName] = useState("");
  const [year, setYear] = useState(currentYear);
  const [frequency, setFrequency] =
    useState<PerformanceCycleFrequency>("semi_annual");
  const [quarter, setQuarter] = useState<QuarterlyPeriod>("Q1");
  const [half, setHalf] = useState<SemiAnnualPeriod>("H1");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const period: QuarterlyPeriod | SemiAnnualPeriod | null =
    frequency === "quarterly"
      ? quarter
      : frequency === "semi_annual"
        ? half
        : null;

  const preview = useMemo(
    () => deriveStandardCyclePeriod(year, frequency, period),
    [year, frequency, period]
  );

  function handleFrequencyChange(next: PerformanceCycleFrequency) {
    setFrequency(next);
    setFieldError(null);
  }

  async function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFieldError("Cycle name is required.");
      return;
    }
    if (trimmedName.length > 255) {
      setFieldError("Cycle name must be at most 255 characters.");
      return;
    }
    if (!yearOptions.includes(year)) {
      setFieldError("Select a valid year.");
      return;
    }
    if (!PERFORMANCE_CYCLE_FREQUENCIES.includes(frequency)) {
      setFieldError("Select a review frequency.");
      return;
    }
    if (
      frequency === "quarterly" &&
      !QUARTERLY_PERIODS.includes(quarter)
    ) {
      setFieldError("Select a quarter.");
      return;
    }
    if (
      frequency === "semi_annual" &&
      !SEMI_ANNUAL_PERIODS.includes(half)
    ) {
      setFieldError("Select a review half.");
      return;
    }

    setFieldError(null);
    setSubmitting(true);
    try {
      await onSubmit(
        frequency === "annual"
          ? { name: trimmedName, year, frequency }
          : { name: trimmedName, year, frequency, period }
      );
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : "Failed to create the cycle.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      closeDisabled={submitting}
      labelledBy="create-cycle-modal-title"
    >
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-paper p-6 shadow-xl dark:border-paper/15">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">
              Performance development
            </p>
            <h2
              id="create-cycle-modal-title"
              className="mt-1 font-bricolage text-[20px] font-medium tracking-tight text-ink"
            >
              New performance cycle
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              Standard cycles: Quarterly (3 months), Semi-Annual (6 months),
              or Annual (12 months). The cycle is created as Draft for
              preparation.
            </p>
          </div>
          <Tooltip label="Close" side="bottom">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-accent/[0.08] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </Tooltip>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          <label className="block">
            <span className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">
              Cycle name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={255}
              placeholder="e.g. 2026 Annual Performance Review"
              disabled={submitting}
              className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-accent dark:border-paper/15"
            />
          </label>

          <label className="block">
            <span className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">
              Year
            </span>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              disabled={submitting}
              className="mt-1.5 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm tabular-nums text-ink outline-none transition-colors focus:border-accent dark:border-paper/15"
            >
              {yearOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span
              id="create-cycle-frequency-label"
              className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted"
            >
              Review frequency
            </span>
            <div
              role="radiogroup"
              aria-labelledby="create-cycle-frequency-label"
              className="mt-1.5 grid grid-cols-1 gap-2"
            >
              {PERFORMANCE_CYCLE_FREQUENCIES.map((option) => {
                const selected = frequency === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleFrequencyChange(option)}
                    disabled={submitting}
                    className={`rounded-lg border px-3 py-2.5 text-left text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      selected
                        ? "border-accent bg-accent/[0.08] text-ink"
                        : "border-line text-muted hover:border-accent/40 hover:text-ink dark:border-paper/15"
                    }`}
                  >
                    {FREQUENCY_LABELS[option]}
                  </button>
                );
              })}
            </div>
          </div>

          {frequency === "quarterly" && (
            <div>
              <span
                id="create-cycle-quarter-label"
                className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted"
              >
                Period
              </span>
              <div
                role="radiogroup"
                aria-labelledby="create-cycle-quarter-label"
                className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                {QUARTERLY_PERIODS.map((option) => {
                  const selected = quarter === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setQuarter(option)}
                      disabled={submitting}
                      className={`rounded-lg border px-3 py-2.5 text-left text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected
                          ? "border-accent bg-accent/[0.08] text-ink"
                          : "border-line text-muted hover:border-accent/40 hover:text-ink dark:border-paper/15"
                      }`}
                    >
                      {QUARTER_LABELS[option]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {frequency === "semi_annual" && (
            <div>
              <span
                id="create-cycle-half-label"
                className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted"
              >
                Period
              </span>
              <div
                role="radiogroup"
                aria-labelledby="create-cycle-half-label"
                className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                {SEMI_ANNUAL_PERIODS.map((option) => {
                  const selected = half === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setHalf(option)}
                      disabled={submitting}
                      className={`rounded-lg border px-3 py-2.5 text-left text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected
                          ? "border-accent bg-accent/[0.08] text-ink"
                          : "border-line text-muted hover:border-accent/40 hover:text-ink dark:border-paper/15"
                      }`}
                    >
                      {HALF_LABELS[option]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div
            aria-live="polite"
            className="rounded-xl border border-line bg-accent/[0.04] px-4 py-3 dark:border-paper/15"
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
              Generated review period (read-only)
            </p>
            {preview ? (
              <>
                <p className="mt-1 font-bricolage text-[17px] font-medium tracking-tight text-ink">
                  {preview.name}
                </p>
                <p className="mt-0.5 text-[12.5px] tabular-nums text-muted">
                  {formatDateOnly(preview.period_start)} –{" "}
                  {formatDateOnly(preview.period_end)}
                </p>
              </>
            ) : (
              <p className="mt-1 text-[12.5px] text-muted">
                Select a valid frequency and period to preview the cycle.
              </p>
            )}
          </div>
        </div>

        {fieldError && (
          <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] font-medium text-red-600">
            {fieldError}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 dark:border-paper/15"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-paper transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create cycle"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
