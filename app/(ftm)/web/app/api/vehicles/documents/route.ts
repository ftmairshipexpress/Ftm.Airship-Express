import { NextResponse } from "next/server";
import { hasPermission } from "../../../lib/permissions";
import { authenticateFtmRequest } from "../../../lib/server/ftmRequestAuth";

export async function POST(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "fvm", "create")) return NextResponse.json({ error: "Permission denied: fvm.create" }, { status: 403 });
  let body: Record<string, any>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  if (!body.vehicle_id || !body.document_type || !body.file_url) {
    return NextResponse.json({ error: "vehicle_id, document_type, and file_url are required" }, { status: 400 });
  }
  const { data, error } = await auth.context.serviceClient.from("vehicle_documents").insert({
    vehicle_id: String(body.vehicle_id),
    document_type: String(body.document_type),
    document_number: body.document_number || null,
    expiry_date: body.expiry_date || null,
    file_url: String(body.file_url),
    status: body.status || "Valid",
  }).select("*").single();
  if (error) return NextResponse.json({ error: "Unable to save vehicle document", details: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}