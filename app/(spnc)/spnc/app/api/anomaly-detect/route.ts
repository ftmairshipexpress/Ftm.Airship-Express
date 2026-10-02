// Save as: app/(spnc)/spnc/app/api/anomaly-detect/route.ts
// AI anomaly detection for the dashboard. The AI finds ALL problems: delivery delays (trips),
// expired rates, overdue SOPs, stale requests, duplicates, …
// The data is read here on the server (lib/assistant/anomalyInput.ts), and the scan is shared with
// the assistant and cached, so Groq is called as little as possible (lib/assistant/anomalyScan.ts).
import { NextResponse } from "next/server";
import { buildScanInput } from "../../../lib/assistant/anomalyInput";
import { scanAnomalies } from "../../../lib/assistant/Anomalyscan";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await scanAnomalies(await buildScanInput());
    // 200 even when the AI is rate-limited: the page shows the message (and any previous results)
    // and tries again after `retryAfter` seconds.
    return NextResponse.json(result);
  } catch (err) {
    console.error("anomaly-detect failed", err);
    return NextResponse.json({ anomalies: [], error: "Request failed" }, { status: 502 });
  }
}