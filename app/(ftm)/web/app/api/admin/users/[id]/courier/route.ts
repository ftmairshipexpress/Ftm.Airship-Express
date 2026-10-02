import { NextResponse } from "next/server";
import { authenticateFtmRequest } from "../../../../../lib/server/ftmRequestAuth";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (auth.context.user.role !== "admin") return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403 });
  let body: { courier_id?: string | null };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const courierId = body.courier_id ? String(body.courier_id) : null;
  const supabase = auth.context.serviceClient;
  const { data: user, error: userError } = await supabase.from("users").select("id, role").eq("id", params.id).maybeSingle();
  if (userError) return NextResponse.json({ error: userError.message }, { status: 500 });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (user.role !== "driver") return NextResponse.json({ error: "Only driver accounts can be assigned to a courier." }, { status: 400 });
  if (courierId) {
    const { data: courier, error } = await supabase.from("couriers").select("id, name").eq("id", courierId).eq("is_active", true).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!courier) return NextResponse.json({ error: "Courier not found or inactive." }, { status: 400 });
  }
  const { data, error } = await supabase.from("users").update({ courier_id: courierId }).eq("id", params.id).select("id, email, full_name, role, courier_id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}