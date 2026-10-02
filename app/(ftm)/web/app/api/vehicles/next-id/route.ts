import { NextResponse } from "next/server";
import { hasPermission } from "../../../lib/permissions";
import { authenticateFtmRequest } from "../../../lib/server/ftmRequestAuth";
import { getNextVehicleId } from "../../../lib/server/ftmVehicles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "fvm", "view")) return NextResponse.json({ error: "Permission denied: fvm.view" }, { status: 403 });
  try {
    const courierId = new URL(request.url).searchParams.get("courier_id");
    return NextResponse.json({ id: await getNextVehicleId(auth.context.serviceClient, courierId) });
  } catch (error) {
    return NextResponse.json({ error: "Unable to calculate the next vehicle ID", details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}