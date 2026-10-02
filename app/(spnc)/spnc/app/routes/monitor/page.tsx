"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Send, RotateCcw, Repeat } from "lucide-react";
import { useShell } from "../../../components/ShellContext";
import PageHeader from "../../../components/PageHeader";

// Packet Tracer-style simulation: walang API, walang Supabase. Sample data lang.

type NodeId = "hr1" | "api" | "sftp" | "queue" | "hr2";
type Tone = "ok" | "warn" | "bad" | "info";
type Packet = {
  id: number;
  name: string;
  path: NodeId[];
  seg: number;
  pos: number;
  status: "moving" | "stuck" | "done";
  x: number;
  y: number;
};
type LogRow = { id: number; at: string; packet: string; device: string; event: string; tone: Tone };

const NODES: Record<NodeId, { label: string; sub: string; x: number; y: number }> = {
  hr1: { label: "HR1", sub: "Pinagmulan", x: 110, y: 210 },
  api: { label: "API Gateway", sub: "Primary · HR-API", x: 450, y: 70 },
  sftp: { label: "SFTP Server", sub: "Fallback 1 · HR-SFTP", x: 450, y: 210 },
  queue: { label: "Message Queue", sub: "Fallback 2 · HR-QUEUE", x: 450, y: 350 },
  hr2: { label: "HR2", sub: "Destinasyon", x: 790, y: 210 },
};

// Ayos = pagkakasunod-sunod ng fallback: API -> SFTP -> Queue
const ROUTES: { code: string; path: NodeId[] }[] = [
  { code: "HR-API", path: ["hr1", "api", "hr2"] },
  { code: "HR-SFTP", path: ["hr1", "sftp", "hr2"] },
  { code: "HR-QUEUE", path: ["hr1", "queue", "hr2"] },
];

const DATASETS = ["Employee Master", "Payroll", "Attendance / DTR", "Leave Balances", "Benefits"];
const SPEED = 170; // px kada segundo

const linkKey = (a: NodeId, b: NodeId) => [a, b].sort().join("-");
const LINKS: [NodeId, NodeId][] = ROUTES.flatMap(
  (r) => [[r.path[0], r.path[1]], [r.path[1], r.path[2]]] as [NodeId, NodeId][]
);
const dist = (a: NodeId, b: NodeId) => Math.hypot(NODES[a].x - NODES[b].x, NODES[a].y - NODES[b].y);

// Hanapin ang unang route na buo ang mga link. Kung nasa gitna na, babalik muna sa HR1.
function findPath(from: NodeId, down: Set<string>) {
  for (const r of ROUTES) {
    const path: NodeId[] = from === "hr1" ? r.path : [from, "hr1", ...r.path.slice(1)];
    if (path.every((n, i) => i === 0 || !down.has(linkKey(path[i - 1], n)))) return { path, code: r.code };
  }
  return null;
}

export default function TransferMonitorPage() {
  const { theme } = useShell();
  const isDark = theme === "dark";

  const packets = useRef<Packet[]>([]);
  const failedRef = useRef<Set<string>>(new Set());
  const logRef = useRef<LogRow[]>([]);
  const counter = useRef(0);
  const [, setTick] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [auto, setAuto] = useState(false);

  const log = (packet: string, device: string, event: string, tone: Tone) => {
    logRef.current = [
      { id: ++counter.current, at: new Date().toLocaleTimeString("en-PH"), packet, device, event, tone },
      ...logRef.current,
    ].slice(0, 40);
  };

  const place = (p: Packet) => {
    const a = NODES[p.path[p.seg]];
    const b = NODES[p.path[p.seg + 1]] ?? a;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    p.x = a.x + ((b.x - a.x) * p.pos) / len;
    p.y = a.y + ((b.y - a.y) * p.pos) / len;
  };

  const reroute = (p: Packet, from: NodeId) => {
    const found = findPath(from, failedRef.current);
    p.seg = 0;
    p.pos = 0;
    if (found) {
      p.path = found.path;
      log(p.name, NODES[from].label, `Putol ang link. Lumipat sa ${found.code}`, "warn");
    } else {
      p.path = [from];
      p.status = "stuck";
      log(p.name, NODES[from].label, "Walang bukas na daan. Kailangan ng manual na aksyon", "bad");
    }
    place(p);
  };

  const step = (dt: number) => {
    for (const p of packets.current) {
      if (p.status !== "moving") continue;
      let budget = SPEED * dt;
      while (budget > 0 && p.status === "moving") {
        const from = p.path[p.seg];
        const to = p.path[p.seg + 1];
        if (failedRef.current.has(linkKey(from, to))) {
          reroute(p, from);
          continue;
        }
        const len = dist(from, to);
        const move = Math.min(budget, len - p.pos);
        p.pos += move;
        budget -= move;
        if (p.pos >= len - 0.01) {
          p.seg++;
          p.pos = 0;
          if (p.seg >= p.path.length - 1) {
            p.status = "done";
            log(p.name, "HR2", "Natanggap ng HR2 ang data", "ok");
          } else {
            log(p.name, NODES[p.path[p.seg]].label, "Naipasa sa susunod na device", "info");
          }
        }
      }
      place(p);
    }
  };

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (packets.current.some((p) => p.status === "moving")) {
        step(dt);
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = () => {
    const id = ++counter.current;
    const p: Packet = {
      id,
      name: `#${id} ${DATASETS[id % DATASETS.length]}`,
      path: ["hr1"],
      seg: 0,
      pos: 0,
      status: "moving",
      x: NODES.hr1.x,
      y: NODES.hr1.y,
    };
    packets.current = [...packets.current.filter((x) => x.status !== "done"), p];
    log(p.name, "HR1", "Nagsimulang magpasa ng data", "info");
    reroute(p, "hr1");
    setTick((t) => t + 1);
  };

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(send, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  const toggleLink = (a: NodeId, b: NodeId) => {
    const k = linkKey(a, b);
    const next = new Set(failedRef.current);
    const down = !next.has(k);
    if (down) next.add(k);
    else next.delete(k);
    failedRef.current = next;
    setFailed(next);
    log("—", `${NODES[a].label} ↔ ${NODES[b].label}`, down ? "Naputol ang link" : "Naibalik ang link", down ? "bad" : "ok");
    if (!down) {
      // subukang ituloy ang mga nakahintong packet
      for (const p of packets.current) {
        if (p.status !== "stuck") continue;
        const found = findPath(p.path[0], next);
        if (found) {
          p.path = found.path;
          p.seg = 0;
          p.pos = 0;
          p.status = "moving";
          log(p.name, NODES[found.path[0]].label, `Itinuloy sa ${found.code}`, "warn");
        }
      }
    }
    setTick((t) => t + 1);
  };

  const reset = () => {
    packets.current = [];
    failedRef.current = new Set();
    logRef.current = [];
    setFailed(new Set());
    setAuto(false);
    setTick((t) => t + 1);
  };

  const c = isDark
    ? { card: "#121B26", line: "#4B5A68", border: "#2C4356", text: "#F2F1EC", muted: "#8FA0AF" }
    : { card: "#FFFFFF", line: "#9CA3AF", border: "#D1D5DB", text: "#111827", muted: "#6B7280" };
  const green = "#1FA968";
  const red = "#E2685A";
  const pink = "#F2419B";
  const toneColor: Record<Tone, string> = { ok: green, warn: "#E5A93C", bad: red, info: c.muted };

  const receivedTotal = logRef.current.filter((l) => l.event.startsWith("Natanggap")).length;
  const moving = packets.current.filter((p) => p.status === "moving").length;
  const stuck = packets.current.filter((p) => p.status === "stuck").length;

  const btn = `flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition ${
    isDark ? "border-[#2C4356] text-[#C7D1DA] hover:bg-[#1A2530]" : "border-gray-300 text-gray-600 hover:bg-gray-100"
  }`;

  return (
    <div className={`min-h-full pb-24 ${isDark ? "bg-[#0B1220]" : "bg-white"}`}>
      <PageHeader
        icon={<Activity size={20} />}
        title="Transfer Monitor"
        subtitle="Simulation ng paglipat ng data mula HR1 papuntang HR2"
      />

      <div className="space-y-5 px-8">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={send}
            className="flex items-center gap-2 rounded-md bg-[#F2419B] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#F55CAB]"
          >
            <Send size={15} /> Magpadala ng data
          </button>
          <button
            type="button"
            onClick={() => setAuto((a) => !a)}
            aria-pressed={auto}
            className={`${btn} ${auto ? "border-[#F2419B] text-[#F2419B]" : ""}`}
          >
            <Repeat size={15} /> Auto {auto ? "(bukas)" : "(sarado)"}
          </button>
          <button type="button" onClick={reset} className={btn}>
            <RotateCcw size={15} /> I-reset
          </button>
          <span className="text-sm" style={{ color: c.muted }}>
            {moving} papunta · {receivedTotal} natanggap · {stuck} nakahinto
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: c.border, background: c.card }}>
          <svg viewBox="0 0 900 420" className="mx-auto min-w-[720px] w-full" role="img" aria-label="Network topology ng HR1 papuntang HR2">
            {LINKS.map(([a, b]) => {
              const k = linkKey(a, b);
              const down = failed.has(k);
              const A = NODES[a];
              const B = NODES[b];
              const mx = (A.x + B.x) / 2;
              const my = (A.y + B.y) / 2;
              return (
                <g key={k}>
                  <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={down ? red : c.line} strokeWidth={3} strokeDasharray={down ? "8 6" : undefined} />
                  <g
                    onClick={() => toggleLink(a, b)}
                    style={{ cursor: "pointer" }}
                    role="button"
                    aria-label={`${down ? "Ibalik" : "Putulin"} ang link ${NODES[a].label} at ${NODES[b].label}`}
                  >
                    <title>{down ? "I-click para ibalik ang link" : "I-click para putulin ang link"}</title>
                    <circle cx={mx} cy={my} r={12} fill={c.card} stroke={down ? red : green} strokeWidth={2} />
                    {down ? (
                      <path d={`M${mx - 4} ${my - 4}L${mx + 4} ${my + 4}M${mx + 4} ${my - 4}L${mx - 4} ${my + 4}`} stroke={red} strokeWidth={2} />
                    ) : (
                      <circle cx={mx} cy={my} r={4.5} fill={green} />
                    )}
                  </g>
                </g>
              );
            })}

            {(Object.keys(NODES) as NodeId[]).map((id) => {
              const n = NODES[id];
              const endpoint = id === "hr1" || id === "hr2";
              return (
                <g key={id}>
                  <rect x={n.x - 75} y={n.y - 30} width={150} height={60} rx={10} fill={c.card} stroke={endpoint ? pink : c.border} strokeWidth={endpoint ? 2 : 1.5} />
                  <text x={n.x} y={n.y - 4} textAnchor="middle" fontSize={14} fontWeight={600} fill={c.text}>{n.label}</text>
                  <text x={n.x} y={n.y + 14} textAnchor="middle" fontSize={11} fill={c.muted}>{n.sub}</text>
                  {id === "hr2" && (
                    <text x={n.x} y={n.y + 52} textAnchor="middle" fontSize={12} fill={green}>Natanggap: {receivedTotal}</text>
                  )}
                </g>
              );
            })}

            {packets.current
              .filter((p) => p.status !== "done")
              .map((p) => (
                <g key={p.id} transform={`translate(${p.x - 9} ${p.y - 6})`}>
                  <title>{p.name}</title>
                  <rect width={18} height={12} rx={2} fill={p.status === "stuck" ? red : pink} />
                  <path d="M0 1L9 7L18 1" fill="none" stroke="#fff" strokeWidth={1.2} />
                </g>
              ))}
          </svg>
        </div>

        <p className="text-sm" style={{ color: c.muted }}>
          I-click ang ilaw sa gitna ng isang linya para putulin ito, at i-click ulit para ibalik. Kapag putol ang daan, lilipat ang
          data sa susunod na fallback. Kapag putol lahat, titigil ito.
        </p>

        <div className="overflow-hidden rounded-lg border" style={{ borderColor: c.border, background: c.card }}>
          <table className="min-w-full text-left text-sm">
            <thead style={{ color: c.muted }}>
              <tr>
                {["Oras", "Data", "Device", "Nangyari"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody style={{ color: c.text }}>
              {logRef.current.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center" style={{ color: c.muted }}>
                    Wala pang aktibidad. Pindutin ang “Magpadala ng data”.
                  </td>
                </tr>
              ) : (
                logRef.current.map((l) => (
                  <tr key={l.id} className="border-t" style={{ borderColor: c.border }}>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums" style={{ color: c.muted }}>{l.at}</td>
                    <td className="px-4 py-2">{l.packet}</td>
                    <td className="whitespace-nowrap px-4 py-2">{l.device}</td>
                    <td className="px-4 py-2" style={{ color: toneColor[l.tone] }}>{l.event}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
