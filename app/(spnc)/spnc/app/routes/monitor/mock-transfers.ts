// Fake data lang muna: walang Supabase. HR1 ang nagpapasa ng data papunta sa HR2.

export type LegStatus = "pending" | "in_transit" | "completed" | "delayed" | "failed";
export type TransferStatus = "pending" | "in_transit" | "completed" | "disrupted" | "rerouted";

export type MockRoute = {
  id: string;
  route_code: string;
  route_name: string;
  origin: string;
  destination: string;
  transit_points: string[];
  fallback_route_id: string | null;
};

export type Leg = {
  id: string;
  routeId: string; // saang route galing ang leg na ito
  from: string;
  to: string;
  status: LegStatus;
};

export type TransferEvent = { at: string; type: string; note: string };

export type Transfer = {
  id: string;
  reference_no: string;
  dataset: string;
  records: number;
  routeId: string; // kasalukuyang route (nagbabago kapag na-reroute)
  status: TransferStatus;
  legs: Leg[];
  events: TransferEvent[];
};

// Primary: API. Kapag pumalya -> SFTP. Kapag pumalya rin -> Queue. Kapag pumalya rin -> disrupted.
export const MOCK_ROUTES: MockRoute[] = [
  {
    id: "r1",
    route_code: "HR-API",
    route_name: "HR1 → HR2 Direct API",
    origin: "HR1 Database",
    destination: "HR2 Database",
    transit_points: ["API Gateway"],
    fallback_route_id: "r2",
  },
  {
    id: "r2",
    route_code: "HR-SFTP",
    route_name: "HR1 → HR2 SFTP Batch",
    origin: "HR1 Database",
    destination: "HR2 Database",
    transit_points: ["SFTP Server"],
    fallback_route_id: "r3",
  },
  {
    id: "r3",
    route_code: "HR-QUEUE",
    route_name: "HR1 → HR2 Message Queue",
    origin: "HR1 Database",
    destination: "HR2 Database",
    transit_points: ["Message Queue"],
    fallback_route_id: null, // wakas ng chain
  },
];

export function getRoute(id: string) {
  return MOCK_ROUTES.find((r) => r.id === id)!;
}

// origin + transit_points + destination -> mga leg
export function buildLegs(
  route: Pick<MockRoute, "id" | "origin" | "destination" | "transit_points">,
  startFrom = route.origin
): Leg[] {
  const stops = [startFrom, ...route.transit_points, route.destination];
  return stops.slice(0, -1).map((from, i) => ({
    id: `${route.id}-${from}-${stops[i + 1]}-${Math.random().toString(36).slice(2, 6)}`,
    routeId: route.id,
    from,
    to: stops[i + 1],
    status: "pending" as LegStatus,
  }));
}

function makeTransfer(
  n: number,
  dataset: string,
  records: number,
  routeId: string,
  statuses: LegStatus[],
  status: TransferStatus,
  events: TransferEvent[]
): Transfer {
  const legs = buildLegs(getRoute(routeId)).map((l, i) => ({ ...l, status: statuses[i] ?? "pending" }));
  return { id: `t${n}`, reference_no: `TRF-2026-${String(n).padStart(4, "0")}`, dataset, records, routeId, status, legs, events };
}

export function createInitialTransfers(): Transfer[] {
  return [
    makeTransfer(1, "Employee Master List", 1248, "r1", ["completed", "completed"], "completed", [
      { at: "08:00", type: "started", note: "Nagsimulang magpasa ang HR1" },
      { at: "08:02", type: "completed", note: "Natanggap ng HR2 ang 1,248 records" },
    ]),
    makeTransfer(2, "Payroll Summary (Setyembre)", 1180, "r1", ["completed", "in_transit"], "in_transit", [
      { at: "09:10", type: "started", note: "Nagsimulang magpasa ang HR1" },
      { at: "09:11", type: "completed", note: "Nakarating na sa API Gateway" },
    ]),
    makeTransfer(3, "Attendance / DTR", 5320, "r1", ["completed", "delayed"], "in_transit", [
      { at: "09:30", type: "started", note: "Nagsimulang magpasa ang HR1" },
      { at: "09:34", type: "delayed", note: "Mabagal ang tugon ng HR2 (lampas 30s)" },
    ]),
    makeTransfer(4, "Leave Balances", 1180, "r2", ["completed", "pending"], "in_transit", [
      { at: "07:45", type: "failed", note: "Timeout ang HR2 API (504)" },
      { at: "07:45", type: "rerouted", note: "Nilipat sa HR-SFTP" },
    ]),
    makeTransfer(5, "Benefits Enrollment", 860, "r1", [], "pending", [
      { at: "10:00", type: "scheduled", note: "Naka-iskedyul" },
    ]),
  ];
}

const now = () => new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Ito ang sagot sa tanong na "saan dadaloy kapag may problema":
// pumalyang leg -> fallback route -> (kung wala) disrupted at kailangan ng manual na aksyon.
export function failCurrentLeg(t: Transfer, reason: string): Transfer {
  const idx = t.legs.findIndex((l) => l.status === "in_transit" || l.status === "delayed");
  if (idx === -1) return t;

  const failed = t.legs[idx];
  const legs = t.legs.map((l, i) => (i === idx ? { ...l, status: "failed" as LegStatus } : l));
  const events = [...t.events, { at: now(), type: "failed", note: `${failed.from} → ${failed.to}: ${reason}` }];

  const fallbackId = getRoute(t.routeId).fallback_route_id;
  if (!fallbackId) {
    events.push({ at: now(), type: "disrupted", note: "Wala nang fallback. Kailangan ng manual na aksyon ng operator." });
    return { ...t, legs, events, status: "disrupted" };
  }

  const fallback = getRoute(fallbackId);
  // Magpapatuloy mula sa lokasyong pinagmulan ng pumalyang leg, hindi mula sa simula
  const newLegs = buildLegs(fallback, failed.from).map((l, i) => (i === 0 ? { ...l, status: "in_transit" as LegStatus } : l));
  events.push({ at: now(), type: "rerouted", note: `Nilipat sa ${fallback.route_code} mula sa ${failed.from}` });
  return { ...t, routeId: fallbackId, legs: [...legs, ...newLegs], events, status: "rerouted" };
}

// Pinapatuloy ang kasalukuyang leg (para sa demo)
export function advanceLeg(t: Transfer): Transfer {
  const idx = t.legs.findIndex((l) => l.status === "in_transit" || l.status === "delayed");
  if (idx === -1) return t;
  const legs = t.legs.map((l, i) => {
    if (i === idx) return { ...l, status: "completed" as LegStatus };
    if (i === idx + 1 && l.status === "pending") return { ...l, status: "in_transit" as LegStatus };
    return l;
  });
  const done = legs.every((l) => l.status === "completed" || l.status === "failed") && legs[legs.length - 1].status === "completed";
  const events = [...t.events, { at: now(), type: done ? "completed" : "progress", note: done ? "Natanggap ng HR2 ang data" : `Nakarating na sa ${t.legs[idx].to}` }];
  return { ...t, legs, events, status: done ? "completed" : t.status === "rerouted" ? "rerouted" : "in_transit" };
}