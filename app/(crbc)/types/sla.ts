
export type SLAStatus = "On Time" | "Delayed" | "Pending"

/** The two policy tiers. `null` = destination province missing. */
export type SlaTier = "Metro Manila" | "Province"

export interface SLAPolicy {
  region: SlaTier
  minDays: number
  maxDays: number
}

export interface SLARecord {
  shipmentId: string
  customerId: string
  /** `null` when the booking has no destination province. */
  region: SlaTier | null
  /** `null` when neither Freight Ops ETA nor a policy window is available. */
  expectedDelivery: string | null
  actualDelivery: string | null
  slaStatus: SLAStatus
  daysVariance: number | null
}
