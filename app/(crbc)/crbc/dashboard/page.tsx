import { getDashboardMetrics } from "../../services/crm.service"
import { getPendingDocumentsCount } from "../../services/document.service"
import { getSlaOverviewData } from "../../services/sla.service"
import { Users, Package, Truck, CheckCircle2, Clock, AlertTriangle, UserPlus, ShieldCheck } from "lucide-react"
import ThemeToggle from "@/app/components/ThemeToggle"
import { SHIPMENT_STATUSES } from "../../types/freight-ops"

/**
 * Styles for the REAL Freight Ops `shipment_status` enum.
 *
 * These are the values that actually arrive from the adapter. The previous
 * map ("Booked" / "In Transit" / "Issue" / ...) was produced by converting
 * CRBC booking statuses, which is not the same thing: ACCEPTED means CRBC
 * approved the request, not that a parcel is moving.
 */
const statusStyle: Record<string, string> = {
  Booked: "bg-amber-50 text-amber-600",
  Intake: "bg-zinc-100 text-zinc-600",
  Batched: "bg-teal-50 text-teal-600",
  "Handed Over": "bg-cyan-50 text-cyan-600",
  "In Transit": "bg-blue-50 text-blue-600",
  "Customs Hold": "bg-purple-50 text-purple-600",
  Delayed: "bg-orange-50 text-orange-600",
  Delivered: "bg-emerald-50 text-emerald-600",
  Cancelled: "bg-zinc-50 text-zinc-600",
  Archived: "bg-zinc-50 text-zinc-500",
}

const statusDot: Record<string, string> = {
  Booked: "bg-amber-500",
  Intake: "bg-zinc-400",
  Batched: "bg-teal-500",
  "Handed Over": "bg-cyan-500",
  "In Transit": "bg-blue-500",
  "Customs Hold": "bg-purple-500",
  Delayed: "bg-orange-500",
  Delivered: "bg-emerald-500",
  Cancelled: "bg-zinc-500",
  Archived: "bg-zinc-400",
}

export default async function CrmDashboard() {
  const [metrics, pendingDocs, overview] = await Promise.all([
    getDashboardMetrics(),
    getPendingDocumentsCount(),
    // One call: policies, bookings and the Freight Ops adapter are read once
    // and reused for the status counts, the recent list and the SLA figure.
    getSlaOverviewData(),
  ])

  const { shipments, summary } = overview

  // Counts come from the real Freight Ops shipment_status enum.
  const shipmentStatusCounts = shipments.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1
    return acc
  }, {})

  // Only statuses actually present, in enum order.
  const statusOrder = SHIPMENT_STATUSES.filter((s) => shipmentStatusCounts[s])

  // Newest by the SLA clock origin, which is the operational arrival of the
  // booking — not the Freight Ops row's created_at.
  const recentShipments = [...shipments]
    .sort((a, b) => (a.booking_created_at < b.booking_created_at ? 1 : -1))
    .slice(0, 5)


  const kpis = [
    { label: "Total Customers", value: metrics.totalCustomers, icon: Users, color: "text-indigo-500" },
    { label: "Active Requests", value: metrics.activeShipments, icon: Package, color: "text-blue-500" },
    { label: "In Transit", value: shipmentStatusCounts["In Transit"] ?? 0, icon: Truck, color: "text-blue-500" },
    { label: "Delivered", value: shipmentStatusCounts["Delivered"] ?? 0, icon: CheckCircle2, color: "text-emerald-500" },
    { label: "SLA Compliance", value: `${summary.compliance}%`, icon: ShieldCheck, color: "text-emerald-500" },
    { label: "Pending Documents", value: pendingDocs, icon: Clock, color: "text-amber-500" },
    { label: "Rejected Requests", value: metrics.rejectedRequests, icon: AlertTriangle, color: "text-red-500" },
  ]

  const activity = [
    { label: "New Customers", value: metrics.newCustomersThisMonth ?? 0, icon: UserPlus, color: "text-indigo-500" },
  ]

  return (
    <div className="w-full py-4 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-foreground text-xl font-semibold">Customer Relationship Dashboard</h1>
          <p className="text-muted text-sm mt-0.5">Overview of customers, shipments, and activity</p>
        </div>
        <ThemeToggle />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-background border border-line rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-foreground text-xs">{label}</span>
              <Icon size={14} className={color} />
            </div>
            <p className="text-foreground text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Shipment Status */}
        <div className="bg-background border border-line rounded-xl">
          <div className="px-5 py-4 border-b border-line">
            <h2 className="text-foreground text-sm font-medium">Shipment Status</h2>
          </div>
          <div className="divide-y divide-line">
            {statusOrder.map((status) => (
              <div key={status} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDot[status]}`} />
                  <span className="text-muted text-xs">{status}</span>
                </div>
                <span className="text-foreground text-xs font-medium">{shipmentStatusCounts[status] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Shipments */}
        <div className="bg-background border border-line rounded-xl lg:col-span-2">
          <div className="px-5 py-4 border-b border-line">
            <h2 className="text-foreground text-sm font-medium">Recent Shipments</h2>
          </div>
          <div className="divide-y divide-line">
            {recentShipments.map((s) => (
              <div key={s.shipment_id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-foreground text-xs font-medium">{s.reference}</p>
                  <p className="text-muted text-xs">{s.origin} → {s.destination}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusStyle[s.status]}`}>{s.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Customer Activity */}
      <div className="bg-background border border-line rounded-xl">
        <div className="px-5 py-4 border-b border-line">
          <h2 className="text-foreground text-sm font-medium">Customer Activity</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line">
          {activity.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon size={14} className={color} />
                <span className="text-muted text-xs">{label}</span>
              </div>
              <span className="text-foreground text-sm font-semibold">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}