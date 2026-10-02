import { NextResponse } from "next/server";
import { hasPermission } from "../../lib/permissions";
import { authenticateFtmRequest } from "../../lib/server/ftmRequestAuth";

export const dynamic = "force-dynamic";

const MAINTENANCE_STATUSES = new Set(["scheduled", "in_progress", "completed", "cancelled"]);
const MAINTENANCE_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const RECURRENCE_RULES = new Set(["none", "weekly", "monthly"]);

function normalizeRecord(body: Record<string, any>) {
  const scheduledAt = new Date(String(body.scheduled_at || ""));
  const durationMinutes = Number(body.duration_minutes ?? 60);
  const status = String(body.status || "scheduled").toLowerCase();
  const priority = String(body.priority || "normal").toLowerCase();
  const recurrenceRule = String(body.recurrence_rule || "none").toLowerCase();
  const cost = body.cost === "" || body.cost == null ? 0 : Number(body.cost);

  if (!body.vehicle_id || !body.maintenance_type || !Number.isFinite(scheduledAt.getTime())) {
    return { error: "Vehicle, maintenance type, and a valid scheduled date/time are required." };
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) {
    return { error: "Duration must be between 15 minutes and 24 hours." };
  }
  if (!MAINTENANCE_STATUSES.has(status) || !MAINTENANCE_PRIORITIES.has(priority) || !RECURRENCE_RULES.has(recurrenceRule)) {
    return { error: "Maintenance status, priority, or recurrence option is invalid." };
  }
  if (!Number.isFinite(cost) || cost < 0) return { error: "Cost must be a non-negative number." };

  return {
    record: {
      vehicle_id: String(body.vehicle_id),
      maintenance_type: String(body.maintenance_type).trim(),
      description: String(body.description || body.maintenance_type).trim(),
      cost,
      performed_by: body.mechanic ? String(body.mechanic).trim() : null,
      performed_at: status === "completed" ? body.performed_at || new Date().toISOString() : null,
      next_due_date: body.next_due_date || null,
      scheduled_at: scheduledAt.toISOString(),
      duration_minutes: durationMinutes,
      mechanic: body.mechanic ? String(body.mechanic).trim() : null,
      priority,
      status,
      recurrence_rule: recurrenceRule,
      recurrence_series_id: body.recurrence_series_id || null,
      notes: body.notes ? String(body.notes).trim() : null,
      updated_at: new Date().toISOString(),
    },
  };
}

async function findScheduleConflict(supabase: any, candidate: Record<string, any>, excludeId?: string) {
  if (["completed", "cancelled"].includes(candidate.status)) return null;
  const { data, error } = await supabase.from("maintenance_history").select("*").limit(5000);
  if (error) return { error: error.message };

  const start = Date.parse(candidate.scheduled_at);
  const end = start + candidate.duration_minutes * 60_000;
  const mechanic = String(candidate.mechanic || "").trim().toLowerCase();
  for (const existing of data || []) {
    if (excludeId && String(existing.id) === excludeId) continue;
    if (["completed", "cancelled"].includes(String(existing.status || "").toLowerCase())) continue;
    const existingStart = Date.parse(String(existing.scheduled_at || ""));
    const existingDuration = Number(existing.duration_minutes || 60);
    if (!Number.isFinite(existingStart)) continue;
    const overlaps = start < existingStart + existingDuration * 60_000 && existingStart < end;
    const sameVehicle = String(existing.vehicle_id) === String(candidate.vehicle_id);
    const sameMechanic = mechanic && mechanic === String(existing.mechanic || "").trim().toLowerCase();
    if (overlaps && (sameVehicle || sameMechanic)) {
      return {
        conflict: {
          id: existing.id,
          vehicle_id: existing.vehicle_id,
          mechanic: existing.mechanic,
          scheduled_at: existing.scheduled_at,
          reason: sameVehicle && sameMechanic ? "vehicle and mechanic" : sameVehicle ? "vehicle" : "mechanic",
        },
      };
    }
  }
  return null;
}

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "fvm", "view")) {
    return NextResponse.json({ error: "Permission denied: fvm.view" }, { status: 403 });
  }
  const { data, error } = await auth.context.serviceClient.from("maintenance_history").select("*").order("scheduled_at", { ascending: true, nullsFirst: false });
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
  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const normalized = normalizeRecord(body);
  if ("error" in normalized) return NextResponse.json({ error: normalized.error }, { status: 400 });
  const conflict = await findScheduleConflict(auth.context.serviceClient, normalized.record);
  if (conflict?.error) return NextResponse.json({ error: `Unable to check schedule conflicts: ${conflict.error}` }, { status: 500 });
  if (conflict?.conflict) return NextResponse.json({ error: "This schedule overlaps another appointment for the same vehicle or mechanic.", conflict: conflict.conflict }, { status: 409 });
  const { data, error } = await auth.context.serviceClient.from("maintenance_history").insert([normalized.record]).select("*").single();
  if (error) {
    console.error("Supabase maintenance insert error:", error.message);
    return NextResponse.json({ error: "Failed to create maintenance record" }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "fvm", "update")) {
    return NextResponse.json({ error: "Permission denied: fvm.update" }, { status: 403 });
  }
  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "A maintenance record id is required." }, { status: 400 });
  const normalized = normalizeRecord(body);
  if ("error" in normalized) return NextResponse.json({ error: normalized.error }, { status: 400 });
  const conflict = await findScheduleConflict(auth.context.serviceClient, normalized.record, id);
  if (conflict?.error) return NextResponse.json({ error: `Unable to check schedule conflicts: ${conflict.error}` }, { status: 500 });
  if (conflict?.conflict) return NextResponse.json({ error: "This schedule overlaps another appointment for the same vehicle or mechanic.", conflict: conflict.conflict }, { status: 409 });

  const { data, error } = await auth.context.serviceClient.from("maintenance_history")
    .update(normalized.record)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("Supabase maintenance update error:", error.message);
    return NextResponse.json({ error: "Failed to update maintenance record" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Maintenance record not found." }, { status: 404 });
  return NextResponse.json(data);
}