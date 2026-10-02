"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import {
  Activity,
  ArrowRight,
  TriangleAlert,
  Users,
  UserCheck,
  Building2,
  Warehouse,
  Package,
  Truck,
  Handshake,
  Landmark,
  ShieldAlert,
  Pencil,
  Award,
  Wallet,
} from "lucide-react";
import { useShell } from "../../components/ShellContext";
import PageHeader from "../../components/PageHeader";

// Service Network & Route Planning (this page is the Network Control view)
// Route Planning = the path data should follow between departments, including the error loop.
// Network Monitoring = the live status of every transmission along those routes.
// Simulation only: no API, no Supabase. Sample data.

type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;
type StageId = "hr1" | "hr2" | "hr3" | "hr4" | "sp" | "sc" | "fr" | "fl" | "cb" | "fin" | "derr" | "ehand" | "corr";
type Status = "Pending" | "Processing" | "Completed" | "Error";
type Pt = { x: number; y: number };
type Leg = { pts: Pt[]; lens: number[]; total: number };
type Rec = {
  id: number;
  data: string;
  at: StageId;
  from: StageId;
  to: StageId;
  phase: "dwell" | "move" | "done";
  t: number;
  d: number;
  leg: Leg | null;
  x: number;
  y: number;
  status: Status;
  error: string | null;
  stopped: string | null;
  note: string | null;
  willError: boolean;
  corrected: boolean;
  sentAt: string;
  updatedAt: string;
};

/* ---------- Stages: every department, plus the error lane ---------- */

const STAGES: Record<StageId, { label: string; sub: string; x: number; y: number; icon: IconType; kind: "main" | "error" }> = {
  hr1: { label: "HR 1", sub: "Submits data", x: 100, y: 95, icon: Users, kind: "main" },
  hr2: { label: "HR 2", sub: "Validates data", x: 320, y: 95, icon: UserCheck, kind: "main" },
  hr3: { label: "HR 3", sub: "Reviews performance", x: 540, y: 95, icon: Award, kind: "main" },
  hr4: { label: "HR 4", sub: "Payroll & benefits", x: 760, y: 95, icon: Wallet, kind: "main" },
  sp: { label: "Service Provider", sub: "Forwards data", x: 980, y: 95, icon: Building2, kind: "main" },
  sc: { label: "Supply Chain", sub: "Confirms stock", x: 1200, y: 95, icon: Warehouse, kind: "main" },
  fr: { label: "Freight Operations", sub: "Books the shipment", x: 1200, y: 455, icon: Package, kind: "main" },
  fl: { label: "Fleet & Transport", sub: "Dispatches vehicle", x: 833, y: 455, icon: Truck, kind: "main" },
  cb: { label: "Customer & Business", sub: "Confirms delivery", x: 466, y: 455, icon: Handshake, kind: "main" },
  fin: { label: "Finance", sub: "Bills completed work", x: 100, y: 455, icon: Landmark, kind: "main" },
  derr: { label: "Data Error", sub: "Validation failed", x: 320, y: 275, icon: TriangleAlert, kind: "error" },
  ehand: { label: "Error Handling", sub: "Logs and reviews", x: 650, y: 275, icon: ShieldAlert, kind: "error" },
  corr: { label: "Correction", sub: "Fixes and resubmits", x: 980, y: 275, icon: Pencil, kind: "error" },
};
const STAGE_IDS = Object.keys(STAGES) as StageId[];
const NODE_W = 150;
const NODE_H = 76;

// Route plan: the standard route grouped into phases
const PHASES: { title: string; desc: string; ids: StageId[] }[] = [
  { title: "HR", desc: "Data preparation", ids: ["hr1", "hr2", "hr3", "hr4"] },
  { title: "Network & Supply", desc: "Provider and stock", ids: ["sp", "sc"] },
  { title: "Freight & Fleet", desc: "Booking and dispatch", ids: ["fr", "fl"] },
  { title: "Delivery & Billing", desc: "Close-out", ids: ["cb", "fin"] },
];

const STANDARD_ROUTE: StageId[] = ["hr1", "hr2", "hr3", "hr4", "sp", "sc", "fr", "fl", "cb", "fin"];
const ERROR_ROUTE: StageId[] = ["hr2", "derr", "ehand", "corr", "hr2", "hr3"];

// Next stop after each stage (HR 2 has an extra check for errors)
const NEXT: Partial<Record<StageId, StageId>> = {
  hr1: "hr2",
  hr2: "hr3",
  hr3: "hr4",
  hr4: "sp",
  sp: "sc",
  sc: "fr",
  fr: "fl",
  fl: "cb",
  cb: "fin",
  derr: "ehand",
  ehand: "corr",
  corr: "hr2",
};

/* ---------- Legs (paths between stages) ---------- */

const mk = (pts: [number, number][]): Leg => {
  const P = pts.map(([x, y]) => ({ x, y }));
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < P.length; i++) {
    const l = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
    lens.push(l);
    total += l;
  }
  return { pts: P, lens, total };
};

const LEGS: Record<string, Leg> = {
  "hr1>hr2": mk([[175, 95], [245, 95]]),
  "hr2>hr3": mk([[395, 95], [465, 95]]),
  "hr3>hr4": mk([[615, 95], [685, 95]]),
  "hr4>sp": mk([[835, 95], [905, 95]]),
  "sp>sc": mk([[1055, 95], [1125, 95]]),
  "sc>fr": mk([[1275, 95], [1340, 95], [1340, 455], [1275, 455]]),
  "fr>fl": mk([[1125, 455], [908, 455]]),
  "fl>cb": mk([[758, 455], [541, 455]]),
  "cb>fin": mk([[391, 455], [175, 455]]),
  "hr2>derr": mk([[290, 133], [290, 237]]),
  "derr>ehand": mk([[395, 275], [575, 275]]),
  "ehand>corr": mk([[725, 275], [905, 275]]),
  "corr>hr2": mk([[980, 237], [980, 185], [350, 185], [350, 133]]),
};

const EDGES: { key: string; label: string; lx: number; ly: number; anchor: "start" | "middle" | "end"; rotate?: boolean; error: boolean }[] = [
  { key: "hr1>hr2", label: "Submitted", lx: 210, ly: 84, anchor: "middle", error: false },
  { key: "hr2>hr3", label: "Validated", lx: 430, ly: 84, anchor: "middle", error: false },
  { key: "hr3>hr4", label: "Reviewed", lx: 650, ly: 84, anchor: "middle", error: false },
  { key: "hr4>sp", label: "Approved", lx: 870, ly: 84, anchor: "middle", error: false },
  { key: "sp>sc", label: "Forwarded", lx: 1090, ly: 84, anchor: "middle", error: false },
  { key: "sc>fr", label: "Stock ready", lx: 1356, ly: 275, anchor: "middle", rotate: true, error: false },
  { key: "fr>fl", label: "Dispatched", lx: 1016, ly: 444, anchor: "middle", error: false },
  { key: "fl>cb", label: "Delivered", lx: 650, ly: 444, anchor: "middle", error: false },
  { key: "cb>fin", label: "Invoiced", lx: 283, ly: 444, anchor: "middle", error: false },
  { key: "hr2>derr", label: "Validation failed", lx: 282, ly: 189, anchor: "end", error: true },
  { key: "derr>ehand", label: "Logged", lx: 485, ly: 264, anchor: "middle", error: true },
  { key: "ehand>corr", label: "Fix requested", lx: 815, ly: 264, anchor: "middle", error: true },
  { key: "corr>hr2", label: "Resubmitted", lx: 665, ly: 177, anchor: "middle", error: true },
];

const along = (leg: Leg, d: number): Pt => {
  let r = Math.min(Math.max(d, 0), leg.total);
  for (let i = 0; i < leg.lens.length; i++) {
    if (r <= leg.lens[i]) {
      const a = leg.pts[i];
      const b = leg.pts[i + 1];
      const t = leg.lens[i] ? r / leg.lens[i] : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    r -= leg.lens[i];
  }
  return leg.pts[leg.pts.length - 1];
};

/* ---------- Sample data and timing ---------- */

const DATA_TYPES = [
  "Employee Data",
  "Attendance Data",
  "Payroll Data",
  "Booking Data",
  "Shipment Data",
  "Inventory Data",
  "Dispatch Data",
  "Customer Order",
  "Invoice Data",
];
const ERRORS = ["Missing field", "Invalid format", "Duplicate record", "Wrong employee ID"];
const DWELL: Record<StageId, number> = {
  hr1: 1.8, hr2: 1.8, hr3: 1.8, hr4: 1.8, sp: 1.8, sc: 1.8, fr: 1.8, fl: 1.8, cb: 1.8, fin: 0, derr: 2.2, ehand: 2.8, corr: 2.8,
};
const SPEED = 85; // px per second
const MAX_ROWS = 14;
const MAX_ACTIVE = 8;
const ERROR_RATE = 0.25;

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const nowText = () => new Date().toLocaleTimeString("en-PH");

export default function RoutesPage() {
  const { theme } = useShell();
  const isDark = theme === "dark";

  const recs = useRef<Rec[]>([]);
  const heat = useRef<Record<string, { color: string; v: number }>>({});
  const idRef = useRef(0);
  const spawnIn = useRef(0.3);
  const [, setTick] = useState(0);

  /* ---------- Colors ---------- */

  const c = isDark
    ? { card: "#0E1624", node: "#121B26", dot: "#1E2D40", line: "#4B5A68", border: "#2C4356", text: "#F2F1EC", muted: "#8FA0AF", row: "#121B26" }
    : { card: "#F6F8FB", node: "#FFFFFF", dot: "#D5DCE6", line: "#9CA3AF", border: "#D1D5DB", text: "#111827", muted: "#6B7280", row: "#FFFFFF" };
  const pink = "#F2419B";
  const blue = "#3B82F6";
  const green = "#1FA968";
  const red = "#E2685A";
  const statusColor: Record<Status, string> = { Pending: c.muted, Processing: blue, Completed: green, Error: red };
  const halo = { paintOrder: "stroke", stroke: c.card, strokeWidth: 4, strokeLinejoin: "round" } as const;

  /* ---------- Simulation ---------- */

  const touch = (p: Rec) => {
    p.updatedAt = nowText();
  };

  const startLeg = (p: Rec, to: StageId) => {
    p.leg = LEGS[`${p.at}>${to}`];
    p.from = p.at;
    p.to = to;
    p.d = 0;
    p.phase = "move";
    if (p.at === "hr1") p.status = "Processing";
    touch(p);
  };

  const arrive = (p: Rec) => {
    const leg = p.leg!;
    const end = leg.pts[leg.pts.length - 1];
    p.x = end.x;
    p.y = end.y;
    p.at = p.to;
    p.leg = null;
    p.t = DWELL[p.at];
    p.phase = "dwell";
    if (p.at === "fin") {
      p.status = "Completed";
      p.phase = "done";
    } else if (p.at === "derr" || p.at === "ehand") {
      p.status = "Error";
    } else if (p.at === "hr2" && p.from === "corr") {
      p.status = "Processing";
      p.note = p.error ? `Corrected: ${p.error}` : null;
      p.error = null;
      p.stopped = null;
      p.corrected = true;
    } else {
      p.status = "Processing";
    }
    touch(p);
  };

  const advance = (p: Rec) => {
    // HR 2 validates the data. A bad record leaves the standard route and enters the error route.
    if (p.at === "hr2" && p.willError && !p.corrected) {
      p.error = pick(ERRORS);
      p.stopped = "HR 2 (validation)";
      p.status = "Error";
      return startLeg(p, "derr");
    }
    const next = NEXT[p.at];
    if (next) startLeg(p, next);
  };

  const spawn = (forceError = false) => {
    const start = LEGS["hr1>hr2"].pts[0];
    const p: Rec = {
      id: ++idRef.current,
      data: pick(DATA_TYPES),
      at: "hr1",
      from: "hr1",
      to: "hr2",
      phase: "dwell",
      t: DWELL.hr1,
      d: 0,
      leg: null,
      x: start.x,
      y: start.y,
      status: "Pending",
      error: null,
      stopped: null,
      note: null,
      willError: forceError || Math.random() < ERROR_RATE,
      corrected: false,
      sentAt: nowText(),
      updatedAt: nowText(),
    };
    recs.current = [p, ...recs.current].slice(0, MAX_ROWS);
  };

  const step = (dt: number) => {
    for (const p of recs.current) {
      if (p.phase === "done") continue;
      if (p.phase === "dwell") {
        p.t -= dt;
        if (p.t <= 0) advance(p);
      } else if (p.leg) {
        p.d += SPEED * dt;
        heat.current[`${p.from}>${p.to}`] = { color: statusColor[p.status], v: 1 };
        if (p.d >= p.leg.total) {
          arrive(p);
        } else {
          const pt = along(p.leg, p.d);
          p.x = pt.x;
          p.y = pt.y;
        }
      }
    }
  };

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Fast Refresh keeps useRef values, so drop any record that still uses old stage IDs
      if (recs.current.some((p) => !(p.at in STAGES) || !(p.from in STAGES) || !(p.to in STAGES))) {
        recs.current = recs.current.filter((p) => p.at in STAGES && p.from in STAGES && p.to in STAGES);
        heat.current = {};
      }
      spawnIn.current -= dt;
      if (spawnIn.current <= 0) {
        if (recs.current.filter((p) => p.phase !== "done").length < MAX_ACTIVE) spawn();
        spawnIn.current = 3.5 + Math.random() * 2.0;
      }
      step(dt);
      for (const k of Object.keys(heat.current)) {
        heat.current[k].v -= dt * 0.9;
        if (heat.current[k].v <= 0) delete heat.current[k];
      }
      setTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Derived ---------- */

  const rows = recs.current;
  const counts: Record<Status, number> = { Pending: 0, Processing: 0, Completed: 0, Error: 0 };
  for (const r of rows) counts[r.status]++;
  const atStage = (id: StageId) => rows.filter((r) => r.phase === "dwell" && r.at === id).length;

  const errorText = (r: Rec) => {
    if (r.status === "Error" && r.error) return { text: `${r.error} · stopped at ${r.stopped}`, color: red };
    if (r.at === "corr" && r.error) return { text: `Fixing: ${r.error}`, color: "#E5A93C" };
    if (r.note) return { text: r.note, color: green };
    return { text: "—", color: c.muted };
  };

  const edgeLabel = (from: StageId, to?: StageId) => (to ? EDGES.find((e) => e.key === `${from}>${to}`)?.label : undefined);

  const StepBadge = ({ id }: { id: StageId }) => {
    const n = atStage(id);
    if (!n) return null;
    const isErr = STAGES[id].kind === "error";
    return (
      <span
        className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
        style={{ background: `${isErr ? red : blue}22`, color: isErr ? red : blue }}
        title="Records at this step right now"
      >
        {n} here
      </span>
    );
  };

  return (
    <div className={`min-h-full pb-24 ${isDark ? "bg-[#0B1220]" : "bg-white"}`}>
      <PageHeader
        icon={<Activity size={20} />}
        title="Service Network & Route Planning"
        subtitle="Network Control: live routes and transmission status across all departments"
      />

      <div className="space-y-5 px-8">
        {/* Route map */}
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: c.border, background: c.card }}>
          <svg
            viewBox="0 0 1400 520"
            className="mx-auto min-w-[1100px] w-full"
            role="img"
            aria-label="Route map from HR 1 through HR 2, HR 3, HR 4, Service Provider, Supply Chain, Freight Operations, Fleet and Transport, Customer and Business to Finance, with an error loop through Data Error, Error Handling and Correction"
          >
            <defs>
              <pattern id="rt-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill={c.dot} />
              </pattern>
              <marker id="rt-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L10 5L0 10z" fill={c.line} />
              </marker>
              <marker id="rt-arrow-err" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L10 5L0 10z" fill={red} />
              </marker>
            </defs>
            <rect width="1400" height="520" fill="url(#rt-grid)" />

            {/* error lane backdrop */}
            <rect x={230} y={205} width={840} height={135} rx={16} fill={red} fillOpacity={0.06} stroke={red} strokeOpacity={0.3} strokeDasharray="6 6" />
            <text x={244} y={224} fontSize={11.5} fontWeight={600} fill={red}>Error route · used when validation fails</text>
            <text x={26} y={34} fontSize={12} fontWeight={600} fill={c.muted}>Standard route</text>
            <text x={26} y={396} fontSize={12} fontWeight={600} fill={c.muted}>Standard route, continued</text>

            {/* edges */}
            {EDGES.map((e) => {
              const leg = LEGS[e.key];
              const h = heat.current[e.key];
              const pts = leg.pts.map((p) => `${p.x},${p.y}`).join(" ");
              return (
                <g key={e.key}>
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={e.error ? red : c.line}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeDasharray={e.error ? "6 5" : undefined}
                    markerEnd={`url(#${e.error ? "rt-arrow-err" : "rt-arrow"})`}
                  />
                  {h && (
                    <>
                      <polyline points={pts} fill="none" stroke={h.color} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={h.v * 0.18} />
                      <polyline points={pts} fill="none" stroke={h.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={h.v * 0.95} />
                    </>
                  )}
                  <text
                    x={e.lx}
                    y={e.ly}
                    textAnchor={e.anchor}
                    fontSize={10.5}
                    fill={e.error ? red : c.muted}
                    transform={e.rotate ? `rotate(-90 ${e.lx} ${e.ly})` : undefined}
                    style={halo}
                  >
                    {e.label}
                  </text>
                </g>
              );
            })}

            {/* departments and error stages */}
            {STAGE_IDS.map((id) => {
              const s = STAGES[id];
              const Icon = s.icon;
              const n = atStage(id);
              const isErr = s.kind === "error";
              const isHub = id === "sp";
              const accent = isErr ? red : isHub ? pink : c.text;
              const ring = n > 0 ? (isErr ? red : isHub ? pink : blue) : isHub ? pink : c.border;
              return (
                <g key={id}>
                  <title>{s.label}</title>
                  <rect
                    x={s.x - NODE_W / 2}
                    y={s.y - NODE_H / 2}
                    width={NODE_W}
                    height={NODE_H}
                    rx={12}
                    fill={c.node}
                    stroke={ring}
                    strokeWidth={n > 0 || isHub ? 2.25 : 1.5}
                  />
                  <Icon x={s.x - 11} y={s.y - 30} width={22} height={22} color={accent} strokeWidth={1.75} />
                  <text x={s.x} y={s.y + 10} textAnchor="middle" fontSize={12.5} fontWeight={600} fill={c.text}>{s.label}</text>
                  <text x={s.x} y={s.y + 25} textAnchor="middle" fontSize={10} fill={c.muted}>{s.sub}</text>
                  {n > 0 && (
                    <g>
                      <circle cx={s.x + NODE_W / 2 - 4} cy={s.y - NODE_H / 2 + 4} r={10} fill={isErr ? red : blue} />
                      <text x={s.x + NODE_W / 2 - 4} y={s.y - NODE_H / 2 + 8} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{n}</text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* packets */}
            {rows
              .filter((p) => p.phase !== "done")
              .map((p) => {
                const col = statusColor[p.status];
                const tail = p.phase === "move" && p.leg ? along(p.leg, p.d - 26) : null;
                return (
                  <g key={p.id} style={{ pointerEvents: "none" }}>
                    <title>{`#${p.id} ${p.data} · ${p.status}`}</title>
                    {tail && <line x1={tail.x} y1={tail.y} x2={p.x} y2={p.y} stroke={col} strokeWidth={3} strokeLinecap="round" strokeOpacity={0.4} />}
                    <circle cx={p.x} cy={p.y} r={9} fill={col} fillOpacity={0.2} />
                    <circle cx={p.x} cy={p.y} r={4.5} fill={col} stroke={c.card} strokeWidth={1.5} />
                  </g>
                );
              })}
          </svg>
        </div>

        {/* Route plan */}
        <div className="space-y-4 rounded-lg border p-4" style={{ borderColor: c.border, background: c.row }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold" style={{ color: c.text }}>Route plan</div>
              <div className="text-xs" style={{ color: c.muted }}>
                {STANDARD_ROUTE.length} steps from HR 1 to Finance, with a correction loop when validation fails
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs" style={{ color: c.muted }}>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded" style={{ background: c.line }} /> Standard</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded border-t-2 border-dashed" style={{ borderColor: red }} /> Error route</span>
            </div>
          </div>

          {/* Standard route, by phase */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {PHASES.map((phase, pi) => (
              <div key={phase.title} className="relative rounded-lg border p-3" style={{ borderColor: c.border, background: c.card }}>
                <div className="mb-2">
                  <div className="whitespace-nowrap text-[10px] font-bold uppercase tracking-wider" style={{ color: pink }}>Phase {pi + 1}</div>
                  <div className="text-sm font-semibold" style={{ color: c.text }}>{phase.title}</div>
                  <div className="text-[11px]" style={{ color: c.muted }}>{phase.desc}</div>
                </div>
                <ol className="list-none space-y-1 p-0">
                  {phase.ids.map((id, i) => {
                    const s = STAGES[id];
                    const Icon = s.icon;
                    const stepNo = STANDARD_ROUTE.indexOf(id) + 1;
                    const next = STANDARD_ROUTE[STANDARD_ROUTE.indexOf(id) + 1];
                    const handoff = edgeLabel(id, next);
                    const isHub = id === "sp";
                    const isLastInPhase = i === phase.ids.length - 1;
                    return (
                      <li key={id}>
                        <div
                          className="flex items-center gap-2.5 rounded-md border px-2.5 py-2"
                          style={{ borderColor: isHub ? pink : c.border, background: c.node }}
                        >
                          <span
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                            style={{ background: isHub ? pink : id === "fin" ? green : "#475569" }}
                          >
                            {stepNo}
                          </span>
                          <Icon size={16} color={isHub ? pink : c.muted} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold" style={{ color: c.text }}>{s.label}</div>
                            <div className="truncate text-[11px]" style={{ color: c.muted }}>{s.sub}</div>
                          </div>
                          <StepBadge id={id} />
                        </div>
                        {handoff && (
                          <div className="flex items-center gap-1.5 py-0.5 pl-[18px] text-[10.5px]" style={{ color: c.muted }}>
                            <span className="inline-block h-3 border-l" style={{ borderColor: c.line }} />
                            {isLastInPhase ? <ArrowRight size={11} /> : "↓"} {handoff}
                            {isLastInPhase && next ? <span>→ {STAGES[next].label}</span> : null}
                          </div>
                        )}
                        {id === "hr2" && (
                          <div className="mb-1 ml-[18px] rounded px-1.5 py-0.5 text-[10.5px] font-medium" style={{ color: red, background: `${red}14` }}>
                            ⚠ Validation check: failed records take the error route
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>

          {/* Error route */}
          <div className="rounded-lg border border-dashed p-3" style={{ borderColor: `${red}80`, background: `${red}0D` }}>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: red }}>Error route</span>
              <span className="text-[11px]" style={{ color: c.muted }}>
                Starts when HR 2 validation fails, then rejoins the standard route at HR 2 and continues to HR 3
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {ERROR_ROUTE.map((id, i) => {
                const s = STAGES[id];
                const Icon = s.icon;
                const isErr = s.kind === "error";
                const label = i === 0 ? "Validation failed" : edgeLabel(ERROR_ROUTE[i - 1], id);
                return (
                  <span key={`${id}-${i}`} className="flex items-center gap-2">
                    {i > 0 && (
                      <span className="flex items-center gap-1 text-[10.5px]" style={{ color: isErr || ERROR_ROUTE[i - 1] !== "hr2" ? red : c.muted }}>
                        <ArrowRight size={13} /> {label}
                      </span>
                    )}
                    <span
                      className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
                      style={{ borderColor: isErr ? red : c.border, color: isErr ? red : c.text, background: c.node }}
                    >
                      <Icon size={13} color={isErr ? red : c.muted} />
                      {s.label}
                      {isErr && atStage(id) > 0 && (
                        <span className="rounded-full px-1.5 text-[10px] font-bold text-white" style={{ background: red }}>{atStage(id)}</span>
                      )}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {/* Live transmissions */}
        <div className="overflow-hidden rounded-lg border" style={{ borderColor: c.border, background: c.row }}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ color: c.text }}>
            <div className="text-sm font-semibold">Live transmissions</div>
            <div className="flex flex-wrap gap-2 text-xs">
              {(Object.keys(counts) as Status[]).map((s) => (
                <span key={s} className="rounded-full px-2.5 py-1 font-medium" style={{ background: `${statusColor[s]}22`, color: statusColor[s] }}>
                  {s} {counts[s]}
                </span>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead style={{ color: c.muted }}>
                <tr className="border-t" style={{ borderColor: c.border }}>
                  {["Data", "From", "To", "Status", "Error / note", "Sent", "Updated"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ color: c.text }}>
                {rows.length === 0 ? (
                  <tr className="border-t" style={{ borderColor: c.border }}>
                    <td colSpan={7} className="px-4 py-6 text-center" style={{ color: c.muted }}>
                      Waiting for the first transmission.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const e = errorText(r);
                    return (
                      <tr key={r.id} className="border-t" style={{ borderColor: c.border }}>
                        <td className="whitespace-nowrap px-4 py-2">#{r.id} {r.data}</td>
                        <td className="whitespace-nowrap px-4 py-2">{STAGES[r.from]?.label ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2">{STAGES[r.to]?.label ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2">
                          <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: `${statusColor[r.status]}22`, color: statusColor[r.status] }}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-2" style={{ color: e.color }}>{e.text}</td>
                        <td className="whitespace-nowrap px-4 py-2 tabular-nums" style={{ color: c.muted }}>{r.sentAt}</td>
                        <td className="whitespace-nowrap px-4 py-2 tabular-nums" style={{ color: c.muted }}>{r.updatedAt}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
