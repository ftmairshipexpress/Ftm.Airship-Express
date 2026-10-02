"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type {
  CustomerInteractionRow,
  InteractionType,
  PaginatedInteractionsResult,
} from "@/app/(crbc)/services/crm.service";

const TIME_ZONE = "Asia/Manila";
const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: TIME_ZONE });
const timeFormat = new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: TIME_ZONE });

const TYPE_LABELS: Record<InteractionType, string> = {
  WALK_IN: "Walk-in",
  PHONE_CALL: "Phone call",
  PORTAL: "Portal",
};

const RANGE_LABELS: Record<string, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
};

type Props = {
  rows: CustomerInteractionRow[];
  pagination: PaginatedInteractionsResult["pagination"];
  current: { type: string; range: string }; // "all" means no filter
  options: {
    types: readonly InteractionType[];
    ranges: readonly string[];
    pageSizes: readonly number[];
    defaultPageSize: number;
  };
};

function getPageItems(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const items: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) items.push("…");
  for (let i = start; i <= end; i++) items.push(i);
  if (end < totalPages - 1) items.push("…");
  items.push(totalPages);

  return items;
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium text-muted">
      <span>{label}</span>
      <select
        key={value} // remount so the select follows the URL on back/forward
        defaultValue={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-lg border border-line bg-background text-xs text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/15 focus:border-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const arrowBtn =
    "p-1.5 rounded-md border border-line text-muted hover:text-foreground disabled:opacity-40 disabled:hover:text-muted transition-colors";

  return (
    <nav aria-label="Pagination" className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className={arrowBtn}
      >
        <ChevronLeft size={14} />
      </button>

      {getPageItems(page, totalPages).map((item, i) =>
        item === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-xs text-muted">
            …
          </span>
        ) : (
          <button
            type="button"
            key={item}
            onClick={() => onPageChange(item)}
            aria-current={item === page ? "page" : undefined}
            className={`min-w-7 h-7 px-1.5 rounded-md text-xs font-medium transition-colors ${
              item === page ? "bg-primary text-primary-foreground" : "text-muted hover:bg-foreground/20"
            }`}
          >
            {item}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
        className={arrowBtn}
      >
        <ChevronRight size={14} />
      </button>
    </nav>
  );
}

export default function InteractionHistoryClient({ rows, pagination, current, options }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const { page, pageSize, totalCount, totalPages } = pagination;
  const hasActiveFilters = current.type !== "all" || current.range !== "all";

  function push(next: URLSearchParams) {
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  function setFilter(key: string, value: string, defaultValue: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    next.delete("page");
    push(next);
  }

  function clearFilters() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("type");
    next.delete("range");
    next.delete("page");
    push(next);
  }

  function goToPage(p: number) {
    const next = new URLSearchParams(searchParams.toString());
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    push(next);
  }

  const showingFrom = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, totalCount);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-background border border-line rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <FilterSelect
            label="Type:"
            value={current.type}
            onChange={(v) => setFilter("type", v, "all")}
            options={[
              { value: "all", label: "All Types" },
              ...options.types.map((t) => ({ value: t, label: TYPE_LABELS[t] })),
            ]}
          />
          <FilterSelect
            label="Date:"
            value={current.range}
            onChange={(v) => setFilter("range", v, "all")}
            options={[
              { value: "all", label: "All Time" },
              ...options.ranges.map((r) => ({ value: r, label: RANGE_LABELS[r] ?? r })),
            ]}
          />

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-muted hover:text-foreground underline"
            >
              Clear all
            </button>
          )}

          <div className="ml-auto flex items-center gap-2 text-xs text-muted">
            {isPending && <Loader2 size={13} className="animate-spin" />}
            <span>
              {totalCount} {totalCount === 1 ? "interaction" : "interactions"}
            </span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-background border border-line rounded-xl overflow-hidden">
        <div className={`overflow-x-auto transition-opacity ${isPending ? "opacity-60" : ""}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Customer ID", "Full Name", "Type", "Notes", "Date"].map((heading) => (
                  <th
                    key={heading}
                    className="px-4 py-3 font-medium text-xs uppercase tracking-wide"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted text-sm">
                    No interactions match your filters.
                  </td>
                </tr>
              )}

              {rows.map((row) => {
                const date = new Date(row.interaction_date);

                return (
                  <tr
                    key={row.id}
                    className="border-b border-line/60 last:border-0 hover:bg-accent/5 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-accent whitespace-nowrap">
                      {row.customers?.customer_id}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {row.customers?.full_name ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                        <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-accent/10 text-accent">
                          {TYPE_LABELS[row.interaction_type]}
                        </span>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="truncate text-foreground" title={row.notes ?? undefined}>
                        {row.notes ?? "-"}
                      </p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-foreground">{dateFormat.format(date)}</div>
                      <div className="text-xs text-muted">{timeFormat.format(date)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer: rows per page on the left, pagination on the right */}
        <div className="flex flex-col gap-3 px-4 py-3 border-t border-line sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <FilterSelect
              label="Rows per page:"
              value={String(pageSize)}
              onChange={(v) => setFilter("pageSize", v, String(options.defaultPageSize))}
              options={options.pageSizes.map((n) => ({ value: String(n), label: String(n) }))}
            />
            <span className="text-xs text-muted">
              Showing {showingFrom}–{showingTo} of {totalCount} records
            </span>
          </div>

          <Pagination
            page={page}
            totalPages={Math.max(totalPages, 1)}
            onPageChange={goToPage}
          />
        </div>
      </div>
    </div>
  );
}