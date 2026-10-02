import { createClient } from "../library/supabase/server";
import { isSlaTier } from "./delivery-policy";
import type { SLAPolicy } from "../types/sla";


export async function getSLAPoliciesFromStore(): Promise<SLAPolicy[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("delivery_policies")
    .select("region, min_days, max_days")
    .not("region", "is", null);

  if (error) {
    console.error("Load delivery policies error:", error);
    throw new Error("Failed to load delivery policies");
  }

  const policies: SLAPolicy[] = [];

  for (const row of data ?? []) {
    if (!isSlaTier(row.region)) continue;
    policies.push({
      region: row.region,
      minDays: row.min_days,
      maxDays: row.max_days,
    });
  }

  return policies;
}
