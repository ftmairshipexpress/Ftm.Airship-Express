import { NextResponse } from "next/server";
import { hasPermission } from "../../lib/permissions";
import { authenticateFtmRequest } from "../../lib/server/ftmRequestAuth";
import { createFtmServiceClient, createFtmParcelClient } from "../../lib/server/ftmSupabase";
import { getAllowedParcelStatuses, isParcelAvailableForRoutePlanning, isParcelTableError, normalizeParcelResponse } from "../../lib/server/ftmParcels";

export const dynamic = "force-dynamic";

function isPermissionError(error: unknown) {
  return /permission denied|not authorized|rls|role .* has no privilege|cannot access|query.*denied/i.test(String((error as { message?: string })?.message || error || ""));
}

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  if (!hasPermission(context.user.role, "vrds", "view")) {
    return NextResponse.json({ error: "Permission denied: vrds.view" }, { status: 403 });
  }

  const url = new URL(request.url);
  const requestedStatus = String(url.searchParams.get("status") || "").trim();
  const historyMode = String(url.searchParams.get("history") || "").toLowerCase() === "true";
  const supabase = createFtmParcelClient();
  if (!supabase) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  let query = supabase.from("parcels").select("*").limit(1000);
  if (requestedStatus) query = query.ilike("status", requestedStatus);
  let { data, error } = await query;
  if (error && isPermissionError(error)) {
    const serviceClient = createFtmServiceClient();
    if (serviceClient) {
      let fallback = serviceClient.from("parcels").select("*").limit(1000);
      if (requestedStatus) fallback = fallback.ilike("status", requestedStatus);
      const result = await fallback;
      data = result.data;
      error = result.error;
    }
  }
  if (error) {
    if (isPermissionError(error)) return NextResponse.json({ error: "Database access to parcel records is not configured." }, { status: 403 });
    if (isParcelTableError(error) || /fetch failed|econnreset|enotfound|etimedout|network error|connection closed/i.test(error.message)) {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: error.message || "Failed to fetch parcels" }, { status: 500 });
  }
  const rows = Array.isArray(data) ? data : [];
  return NextResponse.json(rows.filter((parcel) => historyMode || isParcelAvailableForRoutePlanning(parcel)).map(normalizeParcelResponse));
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function HEAD(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return new Response(null, { status: auth.response.status });
  if (!hasPermission(auth.context.user.role, "vrds", "view")) return new Response(null, { status: 403 });
  return new Response(null, { status: 200 });
}

