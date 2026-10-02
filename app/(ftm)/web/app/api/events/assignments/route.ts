import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateFtmRequest } from "../../../lib/server/ftmRequestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  const encoder = new TextEncoder();
  let closeStream = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closeStream();
        }
      };
      const ping = setInterval(() => send("ping", { time: Date.now() }), 25000);
      const channel = context.serviceClient
        .channel(`ftm-assignment-events-${randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "trips" }, (payload) => {
          const trip = payload.new as Record<string, unknown> | undefined;
          if (!trip) return;
          if (context.user.role === "driver" && String(trip.driver_id || "") !== context.user.id) return;
          send("assignment", { type: "assignment", trip });
        });

      let closed = false;
      closeStream = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        void context.serviceClient.removeChannel(channel);
        try { controller.close(); } catch { /* Stream may already be closed by the runtime. */ }
      };
      request.signal.addEventListener("abort", closeStream, { once: true });
      void channel.subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") send("error", { message: "Assignment updates are temporarily unavailable." });
      });
    },
    cancel() {
      closeStream();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}