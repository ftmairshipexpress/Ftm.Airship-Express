import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/(hr-dashboard)/supabase/admin-client";
import { getAuthenticatedActor } from "@/performance-development-dashboard/lib/auth/actor";
import {
  auditActorFromPerDevActor,
  insertAuditEvent,
  PERFORMANCE_AUDIT_ENTITY_TYPE,
  PERFORMANCE_AUDIT_REASON,
} from "@/performance-development-dashboard/lib/performance/audit";
import {
  BAD_REQUEST_RESPONSE,
  CONFLICT_RESPONSE,
  FORBIDDEN_RESPONSE,
  requireValidUuid,
} from "@/performance-development-dashboard/lib/performance/validation";
import type {
  DevelopmentPlanItem,
  DevPlanItemStatus,
} from "@/performance-development-dashboard/types";

/**
 * Post-finalization employee follow-through for development actions.
 *
 * Narrowly scoped and intentionally separate from the pre-finalization CRUD in
 * `developmentPlanItems.ts` (whose `finalized_at` guard stays untouched):
 *
 * - Content (`action`, `target`, `employee_id`, `appraisal_id`) is NEVER
 *   written here — only `status` (+ `updated_at`) changes.
 * - Only the assigned employee (authenticated `employeeUuid` equals the item's
 *   `employee_id`) on a FINALIZED appraisal (`finalized_at` set) may advance.
 * - HR Admin accounts are always rejected, even when linked to an employee
 *   record — HR cannot impersonate the employee through this path.
 * - Forward-only, single-step transitions:
 *     not_started → in_progress → completed (terminal)
 *   Skips (`not_started → completed`), regressions (`in_progress →
 *   not_started`), and any move out of `completed` are rejected.
 * - Appraisal history/scoring (`finalized_at`, `final_score`,
 *   `performance_rating`, `status`) is never modified.
 */

const FOLLOW_THROUGH_SELECT =
  "id, appraisal_id, employee_id, action, target, status, created_at, updated_at";

/** Forward-only single-step transition map; `null` = terminal. */
const FOLLOW_THROUGH_NEXT: Record<DevPlanItemStatus, DevPlanItemStatus | null> =
  {
    not_started: "in_progress",
    in_progress: "completed",
    completed: null,
  };

function isFollowThroughStatus(value: unknown): value is DevPlanItemStatus {
  return value === "not_started" || value === "in_progress" || value === "completed";
}

export type FollowThroughInput = {
  status: DevPlanItemStatus;
};

export async function advanceDevPlanFollowThrough(
  itemId: string,
  input: FollowThroughInput,
): Promise<DevelopmentPlanItem | NextResponse> {
  const itemIdValid = requireValidUuid(itemId, "development plan item id");
  if (itemIdValid instanceof NextResponse) return itemIdValid;

  // Self-scope only: HR Admin accounts never pass, even with a linked
  // employee identity. Managers/employees proceed only as the subject.
  const actor = await getAuthenticatedActor();
  if (actor instanceof NextResponse) return actor;
  if (actor.actorType === "hr_admin") {
    return FORBIDDEN_RESPONSE();
  }
  if (!actor.employeeUuid) {
    return FORBIDDEN_RESPONSE();
  }

  const requested = input?.status;
  if (!isFollowThroughStatus(requested)) {
    return BAD_REQUEST_RESPONSE(
      "status must be one of: not_started, in_progress, completed.",
    );
  }

  const { data: existing, error: loadError } = await supabaseAdmin
    .from("hr3_performance_development_plan_items")
    .select(FOLLOW_THROUGH_SELECT)
    .eq("id", itemIdValid)
    .maybeSingle();

  if (loadError) {
    console.error("advanceDevPlanFollowThrough: query error:", loadError);
    return BAD_REQUEST_RESPONSE("Failed to load development plan item.");
  }

  if (!existing) {
    return NextResponse.json(
      { error: "Development plan item not found." },
      { status: 404 },
    );
  }

  const current = existing as DevelopmentPlanItem;

  // Ownership: the assigned employee only. A different employee — including a
  // manager acting for a direct report — is denied without distinguishing
  // miss from denial details.
  if (current.employee_id !== actor.employeeUuid) {
    return FORBIDDEN_RESPONSE();
  }

  const { data: appraisal, error: appraisalError } = await supabaseAdmin
    .from("hr3_performance_appraisals")
    .select("employee_id, status, finalized_at")
    .eq("id", current.appraisal_id)
    .maybeSingle();

  if (appraisalError) {
    console.error("advanceDevPlanFollowThrough: appraisal query error:", appraisalError);
    return BAD_REQUEST_RESPONSE("Failed to load appraisal.");
  }

  if (!appraisal) {
    return NextResponse.json({ error: "Appraisal not found." }, { status: 404 });
  }

  // Defense in depth: the appraisal subject must also be the actor.
  if (appraisal.employee_id !== actor.employeeUuid) {
    return FORBIDDEN_RESPONSE();
  }

  // Follow-through is finalized-history only — the inverse of the
  // pre-finalization CRUD guard. Unfinalized items must use the appraisal
  // workflow editor, never this endpoint.
  if (appraisal.finalized_at === null) {
    return CONFLICT_RESPONSE(
      "Only finalized appraisal actions support follow-through. Edit this action inside its appraisal instead.",
    );
  }

  if (!isFollowThroughStatus(current.status)) {
    return BAD_REQUEST_RESPONSE("Stored development action status is invalid.");
  }

  const allowedNext = FOLLOW_THROUGH_NEXT[current.status];
  if (allowedNext === null) {
    return CONFLICT_RESPONSE(
      "This development action is completed and cannot be changed.",
    );
  }
  if (requested !== allowedNext) {
    return CONFLICT_RESPONSE(
      `Invalid transition: ${current.status} cannot move to ${requested}. Only not_started → in_progress and in_progress → completed are allowed.`,
    );
  }

  const updatedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("hr3_performance_development_plan_items")
    // Status-only write: action/target/employee_id/appraisal_id untouched.
    .update({ status: allowedNext, updated_at: updatedAt })
    .eq("id", itemIdValid)
    .eq("status", current.status)
    .select(FOLLOW_THROUGH_SELECT)
    .maybeSingle();

  if (updateError) {
    console.error("advanceDevPlanFollowThrough: update error:", updateError);
    return BAD_REQUEST_RESPONSE("Failed to update development action status.");
  }

  if (!updated) {
    return CONFLICT_RESPONSE(
      "This development action changed before your request. Please refresh and try again.",
    );
  }

  const auditError = await insertAuditEvent({
    actor: auditActorFromPerDevActor(actor),
    entityType: PERFORMANCE_AUDIT_ENTITY_TYPE.developmentPlanItem,
    entityId: itemIdValid,
    reason: PERFORMANCE_AUDIT_REASON.devPlanItemFollowThrough,
    oldData: {
      appraisal_id: current.appraisal_id,
      employee_id: current.employee_id,
      previous_status: current.status,
    },
    newData: {
      appraisal_id: current.appraisal_id,
      employee_id: current.employee_id,
      new_status: allowedNext,
    },
  });
  if (auditError instanceof NextResponse) return auditError;

  return updated as DevelopmentPlanItem;
}
