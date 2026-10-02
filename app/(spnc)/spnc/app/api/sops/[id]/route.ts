// Save as: app/api/sops/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAuditActor, logAuditEvent } from "../../../../lib/audit";
import { getSupabaseClient } from "../../../../lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { data, error } = await getSupabaseClient().from("sops").select("*").eq("id", id).single();

  if (error) {
    if (error.code === "PGRST116") return NextResponse.json({ message: "SOP not found." }, { status: 404 });
    console.error("Fetch SOP error:", error);
    return NextResponse.json({ message: "Could not load SOP." }, { status: 500 });
  }

  return NextResponse.json({ sop: data });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { title, sop_code, category, scope, department, version, effective_date, review_date, content, owner, status } = body;

  if (!title || !sop_code) {
    return NextResponse.json({ message: "Title and SOP code are required." }, { status: 400 });
  }

  const { data, error } = await getSupabaseClient()
    .from("sops")
    .update({
      title,
      sop_code,
      category: category || "general",
      scope: scope || null,
      department: department || null,
      version: version || "1.0",
      effective_date: effective_date || null,
      review_date: review_date || null,
      content: content || null,
      owner: owner || null,
      status: status || "draft",
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Update SOP error:", error);
    return NextResponse.json({ message: "Could not update SOP." }, { status: 500 });
  }

  const actor = await getAuditActor(req);
  if (actor) {
    await logAuditEvent({
      ...actor,
      eventType: "user_activity",
      action: `${actor.actorName} updated SOP "${data.title}"`,
      entityType: "sop",
      entityId: data.id,
      request: req,
    });
  }

  return NextResponse.json({ sop: data });
}

// Archive (not delete): sets archived_at so the SOP disappears from the list
// but can be retrieved later from the audit log (POST /api/audit-logs/[id]/restore).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { data, error } = await getSupabaseClient()
    .from("sops")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .is("archived_at", null)
    .select("id, title, sop_code")
    .maybeSingle();

  if (error) {
    console.error("Archive SOP error:", error);
    return NextResponse.json({ message: "Could not archive SOP." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ message: "SOP not found or already archived." }, { status: 404 });
  }

  const actor = await getAuditActor(req);
  if (actor) {
    await logAuditEvent({
      ...actor,
      eventType: "archive",
      action: `${actor.actorName} archived SOP "${[data.sop_code, data.title].filter(Boolean).join(" · ")}"`,
      entityType: "sop",
      entityId: data.id,
      request: req,
    });
  }

  return NextResponse.json({ success: true });
}