import { NextResponse } from "next/server";
import { hasPermission } from "../../../../lib/permissions";
import { authenticateFtmRequest } from "../../../../lib/server/ftmRequestAuth";

export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

export async function GET(request: Request, { params }: RouteContext) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  if (!hasPermission(context.user.role, "costAnalysis", "update")
    && !hasPermission(context.user.role, "fuelManagement", "update")) {
    return NextResponse.json({ error: "Permission denied: cost or fuel review access is required." }, { status: 403 });
  }

  const { data, error } = await context.serviceClient
    .from("cost_entry_audit")
    .select("id,cost_entry_id,actor_id,action,old_values,new_values,changed_at")
    .eq("cost_entry_id", params.id)
    .order("changed_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: `Unable to load expense audit history: ${error.message}` }, { status: 500 });
  const actorIds = [...new Set((data || []).map((entry) => entry.actor_id).filter(Boolean).map(String))];
  const { data: users } = actorIds.length
    ? await context.serviceClient.from("users").select("id,full_name,email").in("id", actorIds)
    : { data: [] };
  const userById = new Map((users || []).map((user) => [String(user.id), user]));
  return NextResponse.json((data || []).map((entry) => ({
    ...entry,
    actor_name: userById.get(String(entry.actor_id || ""))?.full_name || userById.get(String(entry.actor_id || ""))?.email || null,
  })));
}
