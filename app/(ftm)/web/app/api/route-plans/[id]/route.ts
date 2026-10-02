import { NextResponse } from "next/server";
import { hasPermission } from "../../../lib/permissions";
import { authenticateFtmRequest } from "../../../lib/server/ftmRequestAuth";
import { isRoutePlanSchemaUnavailable, normalizeRoutePlan } from "../../../lib/server/ftmRoutePlans";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  if (!hasPermission(context.user.role, "vrds", "view")) {
    return NextResponse.json({ error: "Permission denied: vrds.view" }, { status: 403 });
  }
  const { data, error } = await context.serviceClient.from("route_plans").select("*").eq("id", params.id).maybeSingle();
  if (error) {
    if (isRoutePlanSchemaUnavailable(error)) return NextResponse.json({ error: "Route plan not found" }, { status: 404 });
    return NextResponse.json({ error: `Unable to load route plan: ${error.message}` }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Route plan not found" }, { status: 404 });
  return NextResponse.json(normalizeRoutePlan(data));
}