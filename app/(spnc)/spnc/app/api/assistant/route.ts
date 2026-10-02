import { NextRequest, NextResponse } from "next/server";
import { runTool, type ToolResult } from "../../../lib/assistant/tool";
import { aiAnswer, aiProvider, type ChatTurn } from "../../../lib/assistant/llm";
import { loadSnapshot, findProvider, findShipment } from "../../../lib/assistant/network";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// POST /api/assistant
// body: { action?: QuickAction, message?: string, history?: { role: "user" | "assistant"; content: string }[] }
// resp: { reply: string, blocks: Block[], suggestions: string[], mode: "ai" | "basic" }
//
// Quick actions and basic questions work without any AI.
// Free-form questions use Groq (GROQ_API_KEY, same as your anomaly routes), or Claude if configured.

const QUICK_ACTIONS: Record<string, { tool: string; args?: Record<string, string> }> = {
  providers: { tool: "list_providers" },
  delayed: { tool: "list_shipments", args: { status: "delayed" } },
  overview: { tool: "network_overview" },
  alerts: { tool: "list_alerts" },
  exceptions: { tool: "list_exceptions" },
  routes: { tool: "list_routes" },
};

/* ------------------------------------------------------------------ */
/* Plain-language summaries (used without AI, and for quick actions)   */
/* ------------------------------------------------------------------ */

function summarize(tool: string, r: ToolResult): string {
  const d = r.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (d?.error) return String(d.error);
  switch (tool) {
    case "network_overview": {
      const p = d.performance;
      const parts = [
        `${p.active} active shipment${p.active === 1 ? "" : "s"} across ${d.providers} providers`,
        p.delayed_now ? `**${p.delayed_now} delayed**` : "none delayed",
      ];
      const rate = p.on_time_rate_pct == null ? "" : ` On-time delivery rate is **${p.on_time_rate_pct}%**.`;
      const al = d.open_alerts ? ` There ${d.open_alerts === 1 ? "is" : "are"} ${d.open_alerts} open alert${d.open_alerts === 1 ? "" : "s"}${d.high_alerts ? ` (${d.high_alerts} high priority)` : ""}.` : " No open alerts.";
      return `${parts.join(", ")}.${rate}${al}`;
    }
    case "list_providers": {
      const list = d as { name: string; on_time_rate_pct: number | null }[];
      if (!list.length) return "No providers match that.";
      const best = list.find((x) => x.on_time_rate_pct != null);
      return `You have ${list.length} service provider${list.length === 1 ? "" : "s"}.${best ? ` Top performer: **${best.name}** at ${best.on_time_rate_pct}% on time.` : ""}`;
    }
    case "provider_details": {
      const p = d.performance;
      return `**${d.provider.name}**${d.provider.type ? ` (${d.provider.type})` : ""}: ${p.trips} trips, ${p.active} active${p.on_time_rate_pct != null ? `, ${p.on_time_rate_pct}% on time` : ""}${p.delayed_now ? `, **${p.delayed_now} delayed now**` : ""}.`;
    }
    case "list_shipments": {
      const n = d.count as number;
      const first = d.shipments?.[0];
      if (!n) return "Nothing matches that.";
      if (first?.delayed && first?.delay_reason) return `${n} shipment${n === 1 ? " is" : "s are"} delayed. Most urgent: **${first.trip}**, ${first.delay_reason}.`;
      return `Found ${n} shipment${n === 1 ? "" : "s"}.`;
    }
    case "shipment_details":
      return `**${d.trip}** is ${d.delayed && d.status !== "delivered" ? "delayed" : String(d.status).replace(/_/g, " ")}${d.last_checkpoint ? `; last seen at ${d.last_checkpoint.location}` : ""}.`;
    case "list_alerts": {
      const net = (d.network_alerts ?? []) as { severity: string }[];
      const data = (d.data_anomalies ?? []) as { severity: string; source?: string }[];
      const n = d.count as number;
      if (!n) return "No open alerts or anomalies. Everything looks healthy.";
      const high = [...net, ...data].filter((a) => a.severity === "high").length;
      const ai = data.filter((a) => a.source === "ai").length;
      const parts: string[] = [];
      if (net.length) parts.push(`${net.length} network alert${net.length === 1 ? "" : "s"}`);
      if (data.length) parts.push(`${data.length} data anomal${data.length === 1 ? "y" : "ies"}${ai ? ` (${ai} found by AI)` : ""}`);
      return `${parts.join(" and ")}${high ? `, **${high} high priority**` : ""}. Tap **Explain** on any item for the likely cause and a fix.`;
    }
    case "list_exceptions": {
      const n = d.count as number;
      if (!n) return "No exceptions found.";
      const kinds = Object.entries(d.by_kind as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
        .join(", ");
      return `${n} exception${n === 1 ? "" : "s"}: ${kinds}.`;
    }
    case "list_routes":
      return `${(d as unknown[]).length} route${(d as unknown[]).length === 1 ? "" : "s"} in the network.`;
    case "provider_rates":
      return `Rates for ${d.provider}.`;
    case "provider_documents":
      return `Documents for ${d.provider}.`;
    default:
      return "Here you go.";
  }
}

/* ------------------------------------------------------------------ */
/* Basic mode: keyword intent → tool                                   */
/* ------------------------------------------------------------------ */

async function basicIntent(message: string): Promise<{ tool: string; args: Record<string, string> } | null> {
  const m = message.toLowerCase();
  const trip = message.match(/\b[A-Z]{2,5}-\d{2,}\b/i)?.[0];
  if (trip) return { tool: "shipment_details", args: { trip } };

  const snap = await loadSnapshot();
  const provider = snap.providers.find((p) => m.includes(p.name.toLowerCase()));

  if (provider && /rate|price|tariff|cost/.test(m)) return { tool: "provider_rates", args: { provider: provider.name } };
  if (provider && /doc|permit|contract|insurance|accredit/.test(m)) return { tool: "provider_documents", args: { provider: provider.name } };
  if (provider && /shipment|trip|assigned/.test(m)) return { tool: "list_shipments", args: { provider: provider.name } };
  if (provider) return { tool: "provider_details", args: { provider: provider.name } };

  if (/delay|late|overdue|behind/.test(m)) return { tool: "list_shipments", args: { status: "delayed" } };
  if (/anomal|duplicate|data quality|master data|sop/.test(m)) return { tool: "list_alerts", args: { category: "data" } };
  if (/alert|warning|urgent|attention/.test(m)) return { tool: "list_alerts", args: {} };
  if (/exception|issue|problem|error|cancel/.test(m)) return { tool: "list_exceptions", args: {} };
  if (/rate|price|tariff/.test(m)) return { tool: "provider_rates", args: {} };
  if (/document|permit|contract|insurance|accredit/.test(m)) return { tool: "provider_documents", args: {} };
  if (/broker|customs/.test(m)) return { tool: "list_providers", args: { type: "customs_broker" } };
  if (/forwarder|forwarding/.test(m)) return { tool: "list_providers", args: { type: "freight_forwarder" } };
  if (/carrier|trucker|trucking/.test(m)) return { tool: "list_providers", args: { type: "carrier" } };
  if (/provider|vendor|partner|performance|ranking|best|worst/.test(m)) return { tool: "list_providers", args: {} };
  if (/route|lane/.test(m)) return { tool: "list_routes", args: {} };
  if (/in transit|active|moving|on the road/.test(m)) return { tool: "list_shipments", args: { status: "active" } };
  if (/deliver/.test(m)) return { tool: "list_shipments", args: { status: "delivered" } };
  if (/shipment|trip|cargo/.test(m)) return { tool: "list_shipments", args: {} };
  if (/overview|summary|status|network|dashboard|how are|today/.test(m)) return { tool: "network_overview", args: {} };

  // A plate number or trip that matches without a pattern
  const s = findShipment(snap, message.trim());
  if (s) return { tool: "shipment_details", args: { trip: s.code } };
  if (findProvider(snap, message)) return { tool: "provider_details", args: { provider: message } };
  return null;
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

const HELP =
  "I can help with **service providers** (carriers, freight forwarders, customs brokers), their performance, shipments, rates and documents, and with **network monitoring**: delays, routes, alerts and exceptions. Try a quick action below, or ask e.g. “How is ABC Trucking performing?” or “Show TRP-0001”.";

// GET /api/assistant: health check. Open it in the browser to confirm the route is installed.
export async function GET() {
  return NextResponse.json({ ok: true, route: "assistant", ai: aiProvider() ?? "off (quick actions only)" });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : null;
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
    const history: ChatTurn[] = Array.isArray(body.history)
      ? body.history
          .filter((h: ChatTurn) => (h?.role === "user" || h?.role === "assistant") && typeof h.content === "string")
          .map((h: ChatTurn) => ({ role: h.role, content: h.content.slice(0, 4000) }))
      : [];

    // 1) Quick actions: instant, no AI needed
    if (action) {
      const qa = QUICK_ACTIONS[action];
      if (!qa) return NextResponse.json({ message: "Unknown action." }, { status: 400 });
      await loadSnapshot(true); // fresh data when a button is pressed
      const r = await runTool(qa.tool, qa.args);
      return NextResponse.json({ reply: summarize(qa.tool, r), blocks: r.blocks, suggestions: r.suggestions ?? [], mode: "basic" });
    }

    if (!message) return NextResponse.json({ reply: HELP, blocks: [], suggestions: [], mode: "basic" });

    // 2) AI answer (Groq by default)
    if (aiProvider()) {
      try {
        const out = await aiAnswer(message, history);
        return NextResponse.json({ reply: out.reply, blocks: out.blocks, suggestions: out.suggestions, mode: "ai" });
      } catch (err) {
        console.error("Assistant AI error, falling back to basic mode:", err);
      }
    }

    // 3) Basic keyword mode
    const intent = await basicIntent(message);
    if (!intent) return NextResponse.json({ reply: HELP, blocks: [], suggestions: ["Network Overview", "View Providers"], mode: "basic" });
    const r = await runTool(intent.tool, intent.args);
    return NextResponse.json({ reply: summarize(intent.tool, r), blocks: r.blocks, suggestions: r.suggestions ?? [], mode: "basic" });
  } catch (err) {
    console.error("Assistant API error:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ message: "The assistant couldn't read the network data.", error: errorMessage }, { status: 500 });
  }
}