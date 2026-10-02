import { createClient } from "../library/supabase/server";
import { getAllShipments, getSLASummary } from "./shipment.service";
import { getSLAPoliciesFromStore } from "./sla-policies.store";

export async function getAnalyticsSummary() {
  const supabase = await createClient();

  // Total customers
  const { count: totalCustomers, error: countError } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true });

  if (countError) {
    throw new Error("Failed to fetch customer count");
  }

  // Active customers (updated in last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { count: activeCustomers, error: activeError } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .gte("updated_at", thirtyDaysAgo.toISOString());

  if (activeError) {
    throw new Error("Failed to fetch active customer count");
  }

  // Inactive customers
  const inactiveCustomers = (totalCustomers ?? 0) - (activeCustomers ?? 0);

  // Shipment data from the Freight Ops adapter. Statuses are the real Freight
  // Ops shipment_status enum values, so comparisons use Title Case.
  const slaPolicies = await getSLAPoliciesFromStore();
  const shipments = await getAllShipments(slaPolicies);

  const totalShipments = shipments.length;

  // Status counts across the real Freight Ops enum.
  const countByStatus = (status: string) =>
    shipments.filter((s) => s.status === status).length;

  const completedShipments = countByStatus("Delivered");
  const inTransitShipments = countByStatus("In Transit");
  const bookedShipments = countByStatus("Booked");
  const cancelledShipments = countByStatus("Cancelled");
  const delayedShipmentsCount = countByStatus("Delayed");
  const customsHoldShipments = countByStatus("Customs Hold");
  const intakeShipments = countByStatus("Intake");
  const batchedShipments = countByStatus("Batched");
  const handedOverShipments = countByStatus("Handed Over");
  const archivedShipments = countByStatus("Archived");

  // SLA compliance from shipment service — delivered shipments only
  const {
    onTime,
    late,
    overdue,
    compliance: slaCompliance,
  } = await getSLASummary();

  // Customer growth - last 6 months
  const customerGrowth: { month: string, customers: number}[] = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    const nextMonth = new Date(date);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const { count, error } = await supabase
      .from("customers")
      .select("*", { count: "exact", head: true })
      .gte("created_at", date.toISOString())
      .lt("created_at", nextMonth.toISOString());

    if (!error) {
      customerGrowth.push({ month: date.toLocaleString("default", { month: "short" }), customers: count ?? 0 });
    } else {
      customerGrowth.push({ month: date.toLocaleString("default", { month: "short" }), customers: 0 });
    }
  }

  // Monthly shipments - last 6 months (from mock data)
  const monthlyShipments: { month: string, count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    const nextMonth = new Date(date);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const monthStart = date.toISOString();
    const monthEnd = nextMonth.toISOString();

    const count = shipments.filter(s => {
      const created = new Date(s.booking_created_at);
      return created >= new Date(monthStart) && created < new Date(monthEnd);
    }).length;

    monthlyShipments.push({ month: date.toLocaleString("default", { month: "short" }), count });
  }

  // Status distribution covers the real Freight Ops enum.
  const statusDistribution = [
    { status: "Booked", count: bookedShipments, color: "bg-amber-400" },
    { status: "In Transit", count: inTransitShipments, color: "bg-blue-400" },
    { status: "Delivered", count: completedShipments, color: "bg-emerald-400" },
    { status: "Delayed", count: delayedShipmentsCount, color: "bg-orange-400" },
    { status: "Customs Hold", count: customsHoldShipments, color: "bg-purple-400" },
    { status: "Cancelled", count: cancelledShipments, color: "bg-red-400" },
    { status: "Intake", count: intakeShipments, color: "bg-zinc-300" },
    { status: "Batched", count: batchedShipments, color: "bg-teal-400" },
    { status: "Handed Over", count: handedOverShipments, color: "bg-cyan-400" },
    { status: "Archived", count: archivedShipments, color: "bg-zinc-300" },
  ].filter((row) => row.count > 0);

  // Regional distribution by SLA tier, from the CRBC booking's destination
  // province. A booking with no province has no tier and is grouped under
  // "Not Evaluable" rather than being dropped.
  const NOT_EVALUABLE = "Not Evaluable";
  const regionalData = shipments.reduce<Record<string, number>>((acc, s) => {
    const key = s.region ?? NOT_EVALUABLE;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const regionalDistribution = Object.entries(regionalData).map(([region, count]) => ({
    region,
    count,
  }));

  return {
    totalCustomers: totalCustomers ?? 0,
    activeCustomers: activeCustomers ?? 0,
    inactiveCustomers,
    totalShipments,
    completedShipments,
    inTransitShipments,
    bookedShipments,
    cancelledShipments,
    slaCompliance,
    onTimeShipments: onTime,
    // `late` = delivered past its window. `overdue` = past due, still moving.
    // Kept distinct: an in-flight parcel is risk, not a completed breach.
    lateShipments: late,
    overdueInFlight: overdue,
    delayedShipments: late,
    customerGrowth,
    monthlyShipments,
    statusDistribution,
    regionalDistribution,
    shipmentsByDestination: regionalDistribution,
    shipmentsByStatus: statusDistribution,
    shipmentDataSource: shipments[0]?.source ?? "mock",
  };
}
