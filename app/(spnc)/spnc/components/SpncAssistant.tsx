"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Image from "next/image";
import {
  X,
  Send,
  RotateCcw,
  Maximize2,
  Minimize2,
  Building2,
  AlertTriangle,
  Network,
  Bell,
  ShieldAlert,
  Map as MapIcon,
  Sparkles,
  Lightbulb,
  ExternalLink,
  Loader2,
} from "lucide-react";
import TripTrackingModal from "./TripTrackingModal";
import robotAvatar from "./assistant/robot-avatar.png";
import robotFull from "./assistant/robot.png"; // robot on the welcome screen

/* ------------------------------------------------------------------ */
/* Types (mirror lib/assistant/tools.ts)                               */
/* ------------------------------------------------------------------ */

type Tone = "good" | "warn" | "bad" | "info" | "neutral";
type Alert = {
  id: string;
  severity: "high" | "medium" | "low";
  kind: string;
  title: string;
  detail: string;
  shipmentId?: string;
  shipmentCode?: string;
  providerName?: string;
  at?: string;
  subject?: string;
  expected?: string;
  current?: string;
  href?: string;
  source?: "network" | "rules" | "ai" | "stored";
};
type Block =
  | { type: "stats"; title?: string; items: { label: string; value: string; tone?: Tone }[] }
  | { type: "table"; title: string; columns: string[]; rows: string[][]; tones?: (Tone | null)[]; shipmentIds?: (string | null)[]; more?: number }
  | { type: "alerts"; title: string; items: Alert[]; more?: number }
  | { type: "note"; text: string; tone?: Tone }
  | { type: "track"; shipmentId: string; label: string };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: Block[];
  suggestions?: string[];
  error?: boolean;
};

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const ENDPOINT = "/spnc/app/api/assistant";
const EXPLAIN_ENDPOINT = "/spnc/app/api/anomaly-explain"; // your existing Groq explain route
const STORAGE_KEY = "spnc-assistant-chat";
const POS_KEY = "spnc-assistant-bubble-pos";
const ASSISTANT_NAME = "Airy AI";
// Loading-screen video, played every time the assistant opens.
// Put the file in your project's public folder: public/assistant/robot-ai.mp4
const ROBOT_VIDEO = "/assistant/robot-ai.mp4";
// Moving robot on the welcome screen (transparent, loops). File: public/assistant/robot-wave.webm
const WELCOME_VIDEO = "/assistant/robot-wave.webm";
const SPLASH_MS = 6000; // how long the loading screen shows (the video loops until then)

const QUICK_ACTIONS = [
  { key: "providers", label: "View Providers", icon: Building2 },
  { key: "delayed", label: "Delayed Shipments", icon: AlertTriangle },
  { key: "overview", label: "Network Overview", icon: Network },
  { key: "alerts", label: "Alerts", icon: Bell },
  { key: "exceptions", label: "Exceptions", icon: ShieldAlert },
] as const;

const ACTION_BY_LABEL: Record<string, string> = Object.fromEntries(QUICK_ACTIONS.map((a) => [a.label.toLowerCase(), a.key]));

const EXAMPLES = [
  "Which carriers have the best on-time rate?",
  "Show shipments assigned to customs brokers",
  "What needs my attention today?",
];

const uid = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------------------------------------------ */
/* Tiny markdown: **bold**, bullet lists, line breaks                  */
/* ------------------------------------------------------------------ */

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={i} className="rounded bg-black/10 px-1 text-[0.92em]">
          {part.slice(1, -1)}
        </code>
      );
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    out.push(
      <ul key={`ul-${out.length}`} className="my-1 list-disc space-y-0.5 pl-4">
        {list.map((l, i) => (
          <li key={i}>{inline(l)}</li>
        ))}
      </ul>
    );
    list = [];
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flush();
    if (!line.trim()) return;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    out.push(
      <p key={i} className={heading ? "font-semibold" : ""}>
        {inline(heading ? heading[1] : line)}
      </p>
    );
  });
  flush();
  return <div className="space-y-1.5">{out}</div>;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

// Rendered by ShellProvider (components/ShellContext.tsx), which passes the theme in.
export default function SpncAssistant({ isDark }: { isDark: boolean }) {

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"ai" | "basic" | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  // Transparent WebM plays in Chrome, Edge and Firefox. Safari can't show the transparency, so it gets the still robot.
  const [canAnimate, setCanAnimate] = useState(false);
  const [welcomeVideoFailed, setWelcomeVideoFailed] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    const isSafari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setCanAnimate(!isSafari && !reduced && !!document.createElement("video").canPlayType('video/webm; codecs="vp9"'));
  }, []);

  /* ---------- loading screen (robot video) before the chat ---------- */
  const [splash, setSplash] = useState(false);
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [splashProgress, setSplashProgress] = useState(0);
  const splashTimer = useRef<number | null>(null);

  function openPanel() {
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setSplashProgress(0);
    setSplashLeaving(false);
    setSplash(!reduced);
    setOpen(true);
  }
  // Fade the loading screen out, then show the chat
  const finishSplash = useCallback(() => {
    if (splashTimer.current) window.clearTimeout(splashTimer.current);
    splashTimer.current = null;
    setSplashProgress(1);
    setSplashLeaving(true);
    window.setTimeout(() => {
      setSplash(false);
      setSplashLeaving(false);
    }, 300);
  }, []);
  // Show the loading screen for SPLASH_MS (video loops), filling the progress bar over that time
  useEffect(() => {
    if (!splash || splashLeaving) return;
    const start = performance.now();
    const tick = window.setInterval(() => setSplashProgress(Math.min(1, (performance.now() - start) / SPLASH_MS)), 100);
    splashTimer.current = window.setTimeout(finishSplash, SPLASH_MS);
    return () => {
      window.clearInterval(tick);
      if (splashTimer.current) window.clearTimeout(splashTimer.current);
    };
  }, [splash, splashLeaving, finishSplash]);
  const [explanations, setExplanations] = useState<Record<string, { loading?: boolean; text?: string; error?: string }>>({});

  async function explain(a: Alert) {
    setExplanations((p) => ({ ...p, [a.id]: { loading: true } }));
    try {
      const res = await fetch(EXPLAIN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: a.title,
          subject: a.subject ?? a.shipmentCode ?? a.providerName ?? a.title,
          expected: a.expected ?? "Normal operation",
          current: a.current ?? a.detail,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.advice) throw new Error(json.error || `HTTP ${res.status}`);
      setExplanations((p) => ({ ...p, [a.id]: { text: json.advice } }));
    } catch (err) {
      setExplanations((p) => ({ ...p, [a.id]: { error: err instanceof Error ? err.message : "Couldn't explain" } }));
    }
  }

  /* ---------- draggable launcher ---------- */
  // Position = distance from the bottom-right corner, so it stays put when the window resizes.
  const BUBBLE = 60; // px
  const [pos, setPos] = useState<{ right: number; bottom: number }>({ right: 24, bottom: 80 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startY: number; right: number; bottom: number; moved: boolean } | null>(null);

  const clamp = useCallback((p: { right: number; bottom: number }) => {
    const maxR = Math.max(8, window.innerWidth - BUBBLE - 8);
    const maxB = Math.max(8, window.innerHeight - BUBBLE - 8);
    return { right: Math.min(Math.max(8, p.right), maxR), bottom: Math.min(Math.max(8, p.bottom), maxB) };
  }, []);

  // Remember where the user left it (per browser)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(POS_KEY);
      if (saved) setPos(clamp(JSON.parse(saved)));
    } catch {
      /* storage unavailable */
    }
    const onResize = () => setPos((p) => clamp(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  function onBubblePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, right: pos.right, bottom: pos.bottom, moved: false };
  }
  function onBubblePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 5) return; // small wiggle = still a click
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
    }
    setPos(clamp({ right: d.right - dx, bottom: d.bottom - dy }));
  }
  function onBubblePointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.moved) {
      setDragging(false);
      setPos((p) => {
        // Snap to the nearest side, like a chat head
        const leftEdge = window.innerWidth - p.right - BUBBLE;
        const snapped = clamp({ ...p, right: leftEdge < p.right ? window.innerWidth - BUBBLE - 16 : 16 });
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(snapped));
        } catch {
          /* storage unavailable */
        }
        return snapped;
      });
    } else {
      openPanel();
    }
  }
  function onBubbleKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPanel();
    }
  }

  // Which side the bubble sits on, so the "Ask Airy AI" hover label points inward
  const bubbleOnLeft = typeof window !== "undefined" && pos.right > window.innerWidth / 2;

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Restore the conversation for this browser tab
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* storage unavailable */
    }
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  useEffect(() => {
    if (open && !splash) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open, splash]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || trackingId) return;
      if (splash) finishSplash();
      else setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, trackingId, splash, finishSplash]);

  const ask = useCallback(
    async (opts: { text?: string; action?: string; label?: string }) => {
      if (busy) return;
      const shown = opts.label ?? opts.text ?? "";
      if (!shown.trim()) return;

      const history = messages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content }))
        .slice(-10);

      setMessages((prev) => [...prev, { id: uid(), role: "user", content: shown }]);
      setInput("");
      setBusy(true);
      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts.action ? { action: opts.action } : { message: opts.text, history }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || json.message || `HTTP ${res.status}`);
        if (json.mode) setMode(json.mode);
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: "assistant", content: json.reply ?? "", blocks: json.blocks ?? [], suggestions: json.suggestions ?? [] },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "assistant",
            content: `Sorry, I couldn't get that. ${err instanceof Error ? err.message : ""}`.trim(),
            error: true,
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, messages]
  );

  function runSuggestion(label: string) {
    const action = ACTION_BY_LABEL[label.toLowerCase()];
    if (action) void ask({ action, label });
    else void ask({ text: label });
  }

  function submit() {
    const text = input.trim();
    if (text) void ask({ text });
  }

  /* ---------- style tokens (same palette as the rest of SPNC) ---------- */
  const panel = isDark ? "bg-[#0E1621] border-[#23303D]" : "bg-white border-gray-200";
  const surface = isDark ? "bg-[#121B26]" : "bg-[#F7F7F9]";
  const card = isDark ? "bg-[#121B26] border-[#23303D]" : "bg-white border-gray-200";
  const primary = isDark ? "text-[#F2F1EC]" : "text-gray-900";
  const body = isDark ? "text-[#C7D1DA]" : "text-gray-700";
  const muted = isDark ? "text-[#8FA0AF]" : "text-gray-500";
  const border = isDark ? "border-[#23303D]" : "border-gray-200";
  const chip = `inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
    isDark
      ? "border-[#2C4356] text-[#C7D1DA] hover:border-[#F2419B] hover:text-[#F77DBB]"
      : "border-gray-300 text-gray-700 hover:border-[#F2419B] hover:text-[#D9297E]"
  }`;

  const toneText: Record<Tone, string> = isDark
    ? { good: "text-[#3BD68A]", warn: "text-[#F2A23B]", bad: "text-[#E2685A]", info: "text-[#7DD3FC]", neutral: "text-[#8FA0AF]" }
    : { good: "text-[#1FA968]", warn: "text-[#C9791A]", bad: "text-[#D9483A]", info: "text-[#0369A1]", neutral: "text-gray-500" };
  const toneBg: Record<Tone, string> = isDark
    ? { good: "bg-[#0F2E22]", warn: "bg-[#2A2010]", bad: "bg-[#2A1212]", info: "bg-[#0F1F2E]", neutral: "bg-[#1A2530]" }
    : { good: "bg-[#E1F7EC]", warn: "bg-[#FDF0DD]", bad: "bg-[#FBE4E1]", info: "bg-[#E0F2FE]", neutral: "bg-gray-100" };
  const sevDot = { high: "bg-[#E2685A]", medium: "bg-[#F2A23B]", low: "bg-[#8FA0AF]" };

  /* ---------- blocks ---------- */
  function renderBlock(b: Block, key: number) {
    switch (b.type) {
      case "stats":
        return (
          <div key={key} className={`rounded-lg border p-2.5 ${card}`}>
            {b.title && <div className={`mb-2 text-[11px] font-semibold ${primary}`}>{b.title}</div>}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {b.items.map((it) => (
                <div key={it.label} className={`rounded-md px-2 py-1.5 ${it.tone ? toneBg[it.tone] : surface}`}>
                  <div className={`truncate text-[10px] uppercase tracking-wide ${muted}`}>{it.label}</div>
                  <div className={`truncate text-sm font-semibold ${it.tone ? toneText[it.tone] : primary}`} title={it.value}>
                    {it.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case "table": {
        const trackable = b.shipmentIds?.some(Boolean);
        return (
          <div key={key} className={`overflow-hidden rounded-lg border ${card}`}>
            <div className={`border-b px-2.5 py-1.5 text-[11px] font-semibold ${border} ${primary}`}>{b.title}</div>
            <div className="max-h-72 overflow-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead className={`sticky top-0 ${surface}`}>
                  <tr>
                    {b.columns.map((c) => (
                      <th key={c} className={`whitespace-nowrap px-2.5 py-1.5 text-left font-semibold uppercase tracking-wide ${muted}`}>
                        {c}
                      </th>
                    ))}
                    {trackable && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, ri) => {
                    const tone = b.tones?.[ri];
                    const sid = b.shipmentIds?.[ri];
                    return (
                      <tr key={ri} className={`border-t ${border}`}>
                        {row.map((cell, ci) => {
                          const isLast = ci === row.length - 1;
                          return (
                            <td
                              key={ci}
                              className={`max-w-[180px] truncate px-2.5 py-1.5 ${
                                ci === 0 ? `font-semibold ${primary}` : isLast && tone ? `font-medium ${toneText[tone]}` : body
                              }`}
                              title={cell}
                            >
                              {cell}
                            </td>
                          );
                        })}
                        {trackable && (
                          <td className="px-1">
                            {sid && (
                              <button
                                type="button"
                                onClick={() => setTrackingId(sid)}
                                className="rounded p-1 text-[#F2419B] hover:bg-[#F2419B]/10"
                                title="Track on map"
                                aria-label="Track on map"
                              >
                                <MapIcon size={13} />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!!b.more && <div className={`border-t px-2.5 py-1 text-[10px] ${border} ${muted}`}>+{b.more} more</div>}
          </div>
        );
      }

      case "alerts":
        return (
          <div key={key} className={`overflow-hidden rounded-lg border ${card}`}>
            <div className={`border-b px-2.5 py-1.5 text-[11px] font-semibold ${border} ${primary}`}>{b.title}</div>
            <ul className={`max-h-80 divide-y overflow-auto ${isDark ? "divide-[#23303D]" : "divide-gray-100"}`}>
              {b.items.map((a) => {
                const ex = explanations[a.id];
                return (
                  <li key={a.id} className="flex items-start gap-2 px-2.5 py-2">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${sevDot[a.severity]}`} title={`${a.severity} priority`} />
                    <div className="min-w-0 flex-1">
                      <div className={`flex items-center gap-1.5 text-xs font-semibold ${primary}`}>
                        <span className="min-w-0">{a.title}</span>
                        {a.source === "ai" && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-[#F2419B]/15 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-[#F2419B]" title="Found by AI anomaly detection (Groq)">
                            <Sparkles size={9} /> AI
                          </span>
                        )}
                      </div>
                      <div className={`text-[11px] ${body}`}>{a.detail}</div>
                      {a.providerName && <div className={`text-[10px] ${muted}`}>{a.providerName}</div>}

                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {!ex?.text && (
                          <button
                            type="button"
                            onClick={() => void explain(a)}
                            disabled={ex?.loading}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#F2419B] hover:underline disabled:opacity-60"
                          >
                            {ex?.loading ? <Loader2 size={10} className="animate-spin" /> : <Lightbulb size={10} />}
                            {ex?.loading ? "Thinking…" : "Explain"}
                          </button>
                        )}
                        {a.href && (
                          // Full page load on purpose: the target page reads ?highlight=…&field=… when it opens,
                          // so this also works when you're already on that page.
                          <a href={a.href} className={`inline-flex items-center gap-1 text-[10px] font-semibold hover:underline ${body}`} title="Open and highlight the record">
                            <ExternalLink size={10} /> Fix
                          </a>
                        )}
                      </div>
                      {ex?.text && (
                        <div className={`mt-1.5 flex gap-1.5 rounded-md px-2 py-1.5 text-[11px] ${toneBg.info} ${toneText.info}`}>
                          <Lightbulb size={12} className="mt-px shrink-0" />
                          <span>{ex.text}</span>
                        </div>
                      )}
                      {ex?.error && <div className="mt-1 text-[10px] text-[#E2685A]">Couldn&apos;t explain: {ex.error}</div>}
                    </div>
                    {a.shipmentId && (
                      <button
                        type="button"
                        onClick={() => setTrackingId(a.shipmentId ?? null)}
                        className="shrink-0 rounded p-1 text-[#F2419B] hover:bg-[#F2419B]/10"
                        title={`Track ${a.shipmentCode ?? ""} on map`}
                        aria-label="Track on map"
                      >
                        <MapIcon size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {!!b.more && <div className={`border-t px-2.5 py-1 text-[10px] ${border} ${muted}`}>+{b.more} more</div>}
          </div>
        );

      case "note":
        return (
          <div key={key} className={`rounded-lg px-2.5 py-2 text-xs ${toneBg[b.tone ?? "neutral"]} ${toneText[b.tone ?? "neutral"]}`}>
            <RichText text={b.text} />
          </div>
        );

      case "track":
        return (
          <button
            key={key}
            type="button"
            onClick={() => setTrackingId(b.shipmentId)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#F2419B] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#F55CAB]"
          >
            <MapIcon size={13} />
            {b.label}
          </button>
        );
    }
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  /* ---------- render ---------- */
  return (
    <>
      {/* Launcher: round, draggable robot bubble (click to open, drag to move) */}
      {!open && (
        <button
          type="button"
          aria-label={`Open ${ASSISTANT_NAME} (drag to move)`}
          title={`Ask ${ASSISTANT_NAME} · drag to move`}
          onPointerDown={onBubblePointerDown}
          onPointerMove={onBubblePointerMove}
          onPointerUp={onBubblePointerUp}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
          }}
          onKeyDown={onBubbleKeyDown}
          style={{ right: pos.right, bottom: pos.bottom, width: BUBBLE, height: BUBBLE, touchAction: "none" }}
          className={`group fixed z-[55] select-none rounded-full bg-[#121314] p-[3px] shadow-xl shadow-[#F2419B]/30 ring-2 ring-[#F2419B]/70 hover:ring-[#F2419B] ${
            dragging ? "scale-110 cursor-grabbing ring-[#F2419B]" : "cursor-grab transition-[transform,right,bottom] duration-200 hover:scale-105"
          }`}
        >
          <span className="pointer-events-none relative block h-full w-full overflow-hidden rounded-full">
            <Image src={robotAvatar} alt="" fill sizes="60px" draggable={false} className="object-cover" priority />
          </span>
          <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#121314] bg-[#3BD68A]" />
          {!dragging && (
            <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${bubbleOnLeft ? "left-full ml-2" : "right-full mr-2"} whitespace-nowrap rounded-full bg-[#121314] px-2.5 py-1 text-[11px] font-semibold text-white opacity-0 shadow-lg transition group-hover:opacity-100`}>
              Ask {ASSISTANT_NAME}
            </span>
          )}
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label={ASSISTANT_NAME}
          className={`fixed z-[55] flex flex-col overflow-hidden border shadow-2xl ${panel} inset-0 sm:inset-auto sm:bottom-6 sm:right-6 sm:rounded-2xl ${
            expanded ? "sm:h-[calc(100vh-3rem)] sm:w-[min(820px,calc(100vw-3rem))]" : "sm:h-[min(680px,calc(100vh-3rem))] sm:w-[420px]"
          }`}
        >
          {/* Loading screen: robot video, then the chat */}
          {splash && (
            <div
              className={`absolute inset-0 z-20 flex flex-col overflow-hidden bg-[#BBBBBE] transition-opacity duration-300 ${splashLeaving ? "opacity-0" : "opacity-100"}`}
              style={{ background: "linear-gradient(#BABBBD, #C3C3C6)" }}
              aria-live="polite"
              aria-label={`Opening ${ASSISTANT_NAME}`}
            >
              <video
                key={ROBOT_VIDEO}
                src={ROBOT_VIDEO}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                onError={() => {
                  console.warn(`Assistant loading video not found: ${ROBOT_VIDEO} (put it in /public${ROBOT_VIDEO})`);
                  finishSplash();
                }}
                className="absolute inset-0 h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={finishSplash}
                className="absolute right-3 top-3 z-10 rounded-full bg-black/40 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur transition hover:bg-black/60"
              >
                Skip
              </button>
              <div className="relative mt-auto bg-gradient-to-t from-[#121314]/85 via-[#121314]/50 to-transparent px-5 pb-6 pt-16 text-white">
                <div className="text-base font-semibold">{ASSISTANT_NAME}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-white/80">
                  <Loader2 size={12} className="animate-spin" />
                  Getting things ready…
                </div>
                <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/25">
                  <div className="h-full rounded-full bg-[#F2419B] transition-[width] duration-200 ease-linear" style={{ width: `${Math.round(splashProgress * 100)}%` }} />
                </div>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="flex items-center gap-3 bg-gradient-to-r from-[#121314] to-[#2A1020] px-4 py-3 text-white">
            <Image src={robotAvatar} alt="" width={40} height={40} className="rounded-full ring-2 ring-[#F2419B]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{ASSISTANT_NAME}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-white/70">
                <span className="h-1.5 w-1.5 rounded-full bg-[#3BD68A]" />
                {busy ? "Checking the network…" : mode === "basic" ? "Online · quick answers" : "Online"}
              </div>
            </div>
            {messages.length > 0 && (
              <button type="button" onClick={() => {
                  setMessages([]);
                  setExplanations({});
                }} className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white" title="New chat" aria-label="New chat">
                <RotateCcw size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="hidden rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white sm:block"
              title={expanded ? "Smaller" : "Larger"}
              aria-label={expanded ? "Smaller" : "Larger"}
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white" title="Close" aria-label="Close">
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className={`flex-1 space-y-4 overflow-y-auto px-3 py-4 ${surface}`}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center px-2 pt-2 text-center">
                {canAnimate && !welcomeVideoFailed ? (
                  <video
                    src={WELCOME_VIDEO}
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload="auto"
                    poster={robotFull.src}
                    aria-label={ASSISTANT_NAME}
                    onError={() => {
                      console.warn(`Assistant welcome video not found: ${WELCOME_VIDEO} (put it in /public${WELCOME_VIDEO})`);
                      setWelcomeVideoFailed(true);
                    }}
                    className="mb-2 h-44 w-auto drop-shadow-lg"
                  />
                ) : (
                  <div className="relative mb-2 h-44 w-36">
                    <Image src={robotFull} alt={ASSISTANT_NAME} fill sizes="144px" className="object-contain drop-shadow-lg" priority />
                  </div>
                )}
                <h2 className={`text-base font-semibold ${primary}`}>Hi! I&apos;m {ASSISTANT_NAME}, your Airship Express assistant.</h2>
                <p className={`mt-1 max-w-[320px] text-xs ${muted}`}>
                  Ask me about service providers, carriers, freight forwarders and customs brokers, or let me watch the network for delays, alerts
                  and exceptions.
                </p>
                <div className="mt-4 grid w-full grid-cols-2 gap-2">
                  {QUICK_ACTIONS.map(({ key, label, icon: Icon }, i) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => void ask({ action: key, label })}
                      disabled={busy}
                      className={`${i === QUICK_ACTIONS.length - 1 && QUICK_ACTIONS.length % 2 ? "col-span-2" : ""} flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition hover:border-[#F2419B] ${card} ${primary}`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#F2419B]/10 text-[#F2419B]">
                        <Icon size={15} />
                      </span>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 w-full space-y-1.5">
                  {EXAMPLES.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void ask({ text: q })}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition ${body} ${isDark ? "hover:bg-[#1A2530]" : "hover:bg-white"}`}
                    >
                      <Sparkles size={13} className="shrink-0 text-[#F2419B]" />
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#F2419B] px-3.5 py-2 text-[13px] text-white">{m.content}</div>
                </div>
              ) : (
                <div key={m.id} className="flex gap-2">
                  <Image src={robotAvatar} alt="" width={28} height={28} className="mt-0.5 h-7 w-7 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    {m.content && (
                      <div
                        className={`inline-block max-w-full rounded-2xl rounded-tl-md border px-3.5 py-2 text-[13px] leading-relaxed ${
                          m.error ? "border-[#E2685A]/40 bg-[#FBE4E1] text-[#D9483A]" : `${card} ${body}`
                        }`}
                      >
                        <RichText text={m.content} />
                      </div>
                    )}
                    {m.blocks?.map((b, i) => renderBlock(b, i))}
                    {m === lastAssistant && !!m.suggestions?.length && !busy && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {m.suggestions.map((s) => (
                          <button key={s} type="button" onClick={() => runSuggestion(s)} className={chip}>
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {busy && (
              <div className="flex items-center gap-2">
                <Image src={robotAvatar} alt="" width={28} height={28} className="h-7 w-7 rounded-full" />
                <div className={`flex gap-1 rounded-2xl rounded-tl-md border px-3.5 py-3 ${card}`}>
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#F2419B]" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quick actions + input */}
          <div className={`border-t ${border} ${isDark ? "bg-[#0E1621]" : "bg-white"}`}>
            {messages.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto px-3 pt-2.5 [scrollbar-width:none]">
                {QUICK_ACTIONS.map(({ key, label, icon: Icon }) => (
                  <button key={key} type="button" onClick={() => void ask({ action: key, label })} disabled={busy} className={chip}>
                    <Icon size={12} />
                    {label}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="flex items-end gap-2 p-3"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder="Ask about providers, shipments, delays…"
                className={`max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border px-3 py-2.5 text-[13px] outline-none focus:border-[#F2419B] ${
                  isDark ? "border-[#2C4356] bg-[#0B1220] text-[#F2F1EC] placeholder:text-[#4B5A68]" : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400"
                }`}
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F2419B] text-white transition hover:bg-[#F55CAB] disabled:opacity-40"
                aria-label="Send"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      )}

      {trackingId && <TripTrackingModal tripId={trackingId} isDark={isDark} onClose={() => setTrackingId(null)} />}
    </>
  );
}
