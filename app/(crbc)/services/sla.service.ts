import { getSlaOverview } from "./shipment.service";
import { SLARecord } from "../types/sla";

export async function getSlaOverviewData() {
  return getSlaOverview();
}

export async function getSLARecords(): Promise<SLARecord[]> {
  const { records } = await getSlaOverview();
  return records;
}

/**
 * Aggregate SLA compliance.
 *
 * Compliance uses DELIVERED shipments only. Overdue in-flight parcels are
 * reported separately as risk, not counted as completed deliveries.
 */
export async function getSLASummary() {
  const { summary } = await getSlaOverview();
  return summary;
}
