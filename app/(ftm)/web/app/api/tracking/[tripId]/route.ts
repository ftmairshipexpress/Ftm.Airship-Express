import { NextResponse } from "next/server";
import { hasPermission } from "../../../lib/permissions";
import { authenticateFtmRequest } from "../../../lib/server/ftmRequestAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { tripId: string } }) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "operations", "view")) return NextResponse.json({ error: "Permission denied: operations.view" }, { status: 403 });
  const { data, error } = await auth.context.serviceClient.from("tracking_history").select("*").eq("trip_id", params.tripId).order("recorded_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Failed to fetch tracking history" }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request, { params }: { params: { tripId: string } }) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "operations", "create")) return NextResponse.json({ error: "Permission denied: operations.create" }, { status: 403 });
  let body: Record<string, any>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const payload: Record<string, any> = { trip_id: params.tripId, tracking_source: "mobile", ...body };
  if (payload.lat !== undefined && payload.latitude === undefined) {
    payload.latitude = Number.parseFloat(payload.lat);
    delete payload.lat;
  }
  if (payload.lng !== undefined && payload.longitude === undefined) {
    payload.longitude = Number.parseFloat(payload.lng);
    delete payload.lng;
  }
  const { data, error } = await auth.context.serviceClient.from("tracking_history").insert([payload]).select("*").single();
  if (error) return NextResponse.json({ error: "Failed to record tracking point" }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}