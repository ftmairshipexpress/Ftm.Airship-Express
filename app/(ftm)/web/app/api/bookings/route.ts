import { NextResponse } from "next/server";
import { hasPermission } from "../../lib/permissions";
import { authenticateFtmRequest } from "../../lib/server/ftmRequestAuth";
import { buildBookingPayload, normalizeBooking } from "../../lib/server/ftmBookings";
import { isRoutePlanSchemaUnavailable, normalizeRoutePlan } from "../../lib/server/ftmRoutePlans";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  if (!hasPermission(context.user.role, "vrds", "view")) {
    return NextResponse.json({ error: "Permission denied: vrds.view" }, { status: 403 });
  }

  const { data, error } = await context.serviceClient.from("bookings").select("*");
  if (error) {
    if (/JWT issued at future|permission denied for table bookings|Could not find the table 'public\.bookings'|invalid JWT|Unauthorized|timed out/i.test(error.message)) {
      console.warn("Bookings table unavailable; returning empty list fallback:", error.message);
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: `Unable to load bookings: ${error.message}` }, { status: 500 });
  }
  const bookings = data || [];
  const routePlanIds = [...new Set(bookings.map((booking) => booking.route_plan_id).filter(Boolean).map(String))];
  const routePlansResult = routePlanIds.length
    ? await context.serviceClient.from("route_plans").select("*").in("id", routePlanIds)
    : { data: [], error: null };
  if (routePlansResult.error && !isRoutePlanSchemaUnavailable(routePlansResult.error)) {
    return NextResponse.json({ error: `Unable to load booking route plans: ${routePlansResult.error.message}` }, { status: 500 });
  }
  const routePlansById = new Map((routePlansResult.data || []).map((routePlan) => [String(routePlan.id), normalizeRoutePlan(routePlan)]));
  return NextResponse.json(bookings.map((booking) => normalizeBooking({
    ...booking,
    routePlan: booking.route_plan_id ? routePlansById.get(String(booking.route_plan_id)) || null : null,
  })));
}

export async function POST(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  if (!hasPermission(context.user.role, "vrds", "create")) {
    return NextResponse.json({ error: "Permission denied: vrds.create" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const payload = buildBookingPayload(body);
  if (!payload.id || !payload.pickup_location || !payload.dropoff_location) {
    return NextResponse.json({ error: "id, pickup_location, and dropoff_location are required" }, { status: 400 });
  }

  const { data, error } = await context.serviceClient.from("bookings").insert(payload).select("*").single();
  if (error) return NextResponse.json({ error: `Unable to create booking: ${error.message}` }, { status: 500 });
  return NextResponse.json(normalizeBooking(data), { status: 201 });
}