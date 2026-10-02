import { NextResponse } from "next/server";
import { hasPermission } from "../../lib/permissions";
import { authenticateFtmRequest } from "../../lib/server/ftmRequestAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "fvm", "view")) {
    return NextResponse.json({ error: "Permission denied: fvm.view" }, { status: 403 });
  }
  const { data, error } = await auth.context.serviceClient.from("maintenance_history").select("*");
  if (error) {
    console.error("Supabase maintenance query error:", error.message);
    return NextResponse.json({ error: "Failed to fetch maintenance records" }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "fvm", "create")) {
    return NextResponse.json({ error: "Permission denied: fvm.create" }, { status: 403 });
  }
  let record: Record<string, unknown>;
  try {
    record = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const { data, error } = await auth.context.serviceClient.from("maintenance_history").insert([record]).select("*").single();
  if (error) {
    console.error("Supabase maintenance insert error:", error.message);
    return NextResponse.json({ error: "Failed to create maintenance record" }, { status: 500 });
  }
  return NextResponse.json(data);
}