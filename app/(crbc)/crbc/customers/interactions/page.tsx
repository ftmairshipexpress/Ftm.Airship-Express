import {
  DATE_PRESETS,
  DEFAULT_PAGE_SIZE,
  INTERACTION_TYPES,
  PAGE_SIZES,
  getCustomerInteractions,
  getPresetStart,
} from "@/app/(crbc)/services/crm.service";
import InteractionHistoryClient from "@/app/(crbc)/components/customers/InteractionHistoryClient";

export default async function CustomerInteractionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; range?: string; page?: string; pageSize?: string }>;
}) {
  const sp = await searchParams;

  // Validate everything that comes from the URL
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = PAGE_SIZES.find((n) => String(n) === sp.pageSize) ?? DEFAULT_PAGE_SIZE;
  const type = INTERACTION_TYPES.find((t) => t === sp.type);
  const range = DATE_PRESETS.find((r) => r === sp.range);

  const { data, pagination } = await getCustomerInteractions({
    page,
    pageSize,
    interactionType: type,
    dateFrom: range ? getPresetStart(range) : undefined,
  });

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Interaction history
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Walk-in, phone, and portal interactions with customers.
        </p>
      </div>

      <InteractionHistoryClient
        rows={data}
        pagination={pagination}
        current={{ type: type ?? "all", range: range ?? "all" }}
        options={{
          types: INTERACTION_TYPES,
          ranges: DATE_PRESETS,
          pageSizes: PAGE_SIZES,
          defaultPageSize: DEFAULT_PAGE_SIZE,
        }}
      />
    </div>
  );
}