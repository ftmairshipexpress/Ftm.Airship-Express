// Save as: app/(spnc)/spnc/app/api/rates/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAuditActor, logAuditEvent } from "../../../../lib/audit";
import { getSupabaseClient } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Rates are standalone records: no route or service provider link.
const RATE_SELECT = "*";

function toNullableText(v: unknown) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
// Money: keep centavos, rounded to 2 decimals
function toMoney(v: unknown, fallback = 0) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback;
}

// One rate (details page)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("rates").select(RATE_SELECT).eq("id", id).single();
  if (error) {
    if (error.code === "PGRST116") return NextResponse.json({ message: "Rate not found." }, { status: 404 });
    console.error("Fetch rate error:", error);
    return NextResponse.json({ message: "Could not load rate." }, { status: 500 });
  }
  return NextResponse.json({ rate: data });
}

// Edit a rate, or Approve / Decline a request (status change)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { rate_code, description, department, charge_type, currency, base_rate, min_charge, surcharge_pct, valid_from, valid_to, status, notes } = body;

  if (!toNullableText(rate_code) || base_rate === undefined || base_rate === null || base_rate === "") {
    return NextResponse.json({ message: "Rate code and base rate are required." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("rates")
    .update({
      rate_code: String(rate_code).trim(),
      description: toNullableText(description),
      department: toNullableText(department),
      charge_type: charge_type || "per_kg",
      currency: currency || "PHP",
      base_rate: toMoney(base_rate),
      min_charge: toMoney(min_charge),
      surcharge_pct: toMoney(surcharge_pct),
      valid_from: toNullableText(valid_from),
      valid_to: toNullableText(valid_to),
      status: status || "draft", // also used by Approve (active) / Decline (declined)
      notes: toNullableText(notes),
    })
    .eq("id", id)
    .select(RATE_SELECT)
    .single();

  if (error) {
    console.error("Update rate error:", error);
    const duplicate = error.code === "23505";
    return NextResponse.json(
      { message: duplicate ? `Rate code "${rate_code}" already exists.` : `Could not update rate: ${error.message}` },
      { status: duplicate ? 409 : 500 }
    );
  }

  const actor = await getAuditActor(req);
  if (actor)
    await logAuditEvent({ ...actor, eventType: "user_activity", action: `${actor.actorName} updated rate "${data.rate_code}"`, entityType: "rate", entityId: data.id, request: req });

  return NextResponse.json({ rate: data });
}

// Archive = hide the rate (sets archived_at) instead of deleting it,
// so it can be retrieved later from Audit Logs → Retrieve.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("rates")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, rate_code")
    .maybeSingle();

  if (error) {
    console.error("Archive rate error:", error);
    const missingColumn = error.code === "42703" || error.code === "PGRST204" || /archived_at/i.test(error.message || "");
    return NextResponse.json(
      {
        message: missingColumn
          ? "Archiving needs an archived_at column on the rates table. Run the rates SQL in the Supabase SQL Editor."
          : "Could not archive rate.",
      },
      { status: 500 }
    );
  }
  if (!data) return NextResponse.json({ message: "Rate not found." }, { status: 404 });

  const actor = await getAuditActor(req);
  if (actor)
    await logAuditEvent({
      ...actor,
      eventType: "archive",
      action: `${actor.actorName} archived rate "${data.rate_code ?? id}"`,
      entityType: "rate",
      entityId: id,
      request: req,
    });

  return NextResponse.json({ success: true });
}