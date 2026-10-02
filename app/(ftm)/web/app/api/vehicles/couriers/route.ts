import { NextResponse } from "next/server";
import { hasPermission } from "../../../lib/permissions";
import { authenticateFtmRequest } from "../../../lib/server/ftmRequestAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "fvm", "view")) return NextResponse.json({ error: "Permission denied: fvm.view" }, { status: 403 });
  const { data, error } = await auth.context.serviceClient.from("couriers").select("id, code, name").eq("is_active", true).order("name");
  if (error) return NextResponse.json({ error: "Unable to load couriers", details: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}