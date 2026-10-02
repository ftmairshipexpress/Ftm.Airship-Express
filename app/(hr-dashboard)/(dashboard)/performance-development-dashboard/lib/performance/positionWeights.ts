/**
 * Position Appraisal Weights — HR-defined Goals-vs-Competencies scoring
 * composition per job position (`hr3_position_appraisal_weights`).
 *
 * HR Admin scope only (all operations). Employees and managers can neither
 * read nor write configuration here; appraisals carry frozen snapshots, so
 * this table is never consulted for historical records.
 *
 * Identity: stable `hr1_job_positions.id` (never display-name matching).
 * Percentages sum to exactly 100 (tolerance mirrors the scoring module).
 */

import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/(hr-dashboard)/supabase/admin-client";
import { assertHrAdminScope } from "@/performance-development-dashboard/lib/auth/access";
import {
  auditActorFromIdentity,
  insertAuditEvent,
  PERFORMANCE_AUDIT_ENTITY_TYPE,
  PERFORMANCE_AUDIT_REASON,
} from "@/performance-development-dashboard/lib/performance/audit";
import {
  BAD_REQUEST_RESPONSE,
  CONFLICT_RESPONSE,
  requireFiniteNumber,
  requireValidUuid,
} from "@/performance-development-dashboard/lib/performance/validation";
import type {
  PositionAppraisalWeights,
  PositionAppraisalWeightsInput,
  UpdatePositionAppraisalWeightsInput,
} from "@/performance-development-dashboard/types";

export type {
  PositionAppraisalWeights,
  PositionAppraisalWeightsInput,
  UpdatePositionAppraisalWeightsInput,
} from "@/performance-development-dashboard/types";

/** Weight row with its position title for HR display. */
export type PositionAppraisalWeightsItem = PositionAppraisalWeights & {
  position_title: string | null;
};

const WEIGHTS_SELECT =
  "id, job_position_id, goal_weight, competency_weight, created_at, updated_at";

/** Tolerance for the percentages-must-total-100 rule (mirrors scoring). */
const WEIGHT_TOTAL_TOLERANCE = 1e-6;

function parseComponentWeight(
  value: unknown,
  field: string
): number | NextResponse {
  const numeric = requireFiniteNumber(value, field);
  if (numeric instanceof NextResponse) return numeric;
  if (numeric < 0 || numeric > 100) {
    return BAD_REQUEST_RESPONSE(
      `${field} must be a number between 0 and 100.`
    );
  }
  return numeric;
}

function validateWeightTotal(
  goalWeight: number,
  competencyWeight: number
): NextResponse | null {
  if (
    Math.abs(goalWeight + competencyWeight - 100) > WEIGHT_TOTAL_TOLERANCE
  ) {
    return BAD_REQUEST_RESPONSE(
      "goal_weight and competency_weight must total exactly 100."
    );
  }
  return null;
}

async function requireExistingPositionId(
  value: unknown
): Promise<string | NextResponse> {
  const id = requireValidUuid(value, "job_position_id");
  if (id instanceof NextResponse) return id;

  const { data, error } = await supabaseAdmin
    .from("hr1_job_positions")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("positionWeights: position query error:", error);
    return NextResponse.json(
      { error: "Failed to validate job position" },
      { status: 500 }
    );
  }
  if (!data) {
    return BAD_REQUEST_RESPONSE(
      "job_position_id does not reference an existing job position."
    );
  }
  return id;
}

async function attachPositionTitles(
  rows: PositionAppraisalWeights[]
): Promise<PositionAppraisalWeightsItem[]> {
  const positionIds = [...new Set(rows.map((row) => row.job_position_id))];
  const titlesById = new Map<string, string>();
  if (positionIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("hr1_job_positions")
      .select("id, title")
      .in("id", positionIds);
    if (!error) {
      for (const position of (data ?? []) as {
        id: string;
        title: string | null;
      }[]) {
        if (position.title) titlesById.set(position.id, position.title);
      }
    } else {
      console.error("positionWeights: position title query error:", error);
    }
  }
  return rows.map((row) => ({
    ...row,
    position_title: titlesById.get(row.job_position_id) ?? null,
  }));
}

export async function listPositionAppraisalWeights(): Promise<
  PositionAppraisalWeightsItem[] | NextResponse
> {
  const admin = await assertHrAdminScope();
  if (admin instanceof NextResponse) return admin;

  const { data, error } = await supabaseAdmin
    .from("hr3_position_appraisal_weights")
    .select(WEIGHTS_SELECT)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("listPositionAppraisalWeights: query error:", error);
    return NextResponse.json(
      { error: "Failed to load position appraisal weights" },
      { status: 500 }
    );
  }

  return attachPositionTitles(
    (data ?? []) as PositionAppraisalWeights[]
  );
}

export async function createPositionAppraisalWeights(
  input: PositionAppraisalWeightsInput
): Promise<PositionAppraisalWeightsItem | NextResponse> {
  const admin = await assertHrAdminScope();
  if (admin instanceof NextResponse) return admin;

  const positionId = await requireExistingPositionId(input?.job_position_id);
  if (positionId instanceof NextResponse) return positionId;

  const goalWeight = parseComponentWeight(input?.goal_weight, "goal_weight");
  if (goalWeight instanceof NextResponse) return goalWeight;
  const competencyWeight = parseComponentWeight(
    input?.competency_weight,
    "competency_weight"
  );
  if (competencyWeight instanceof NextResponse) return competencyWeight;

  const totalError = validateWeightTotal(goalWeight, competencyWeight);
  if (totalError) return totalError;

  const { data: duplicate, error: duplicateError } = await supabaseAdmin
    .from("hr3_position_appraisal_weights")
    .select("id")
    .eq("job_position_id", positionId)
    .maybeSingle();

  if (duplicateError) {
    console.error(
      "createPositionAppraisalWeights: duplicate query error:",
      duplicateError
    );
    return NextResponse.json(
      { error: "Failed to validate position appraisal weights" },
      { status: 500 }
    );
  }
  if (duplicate) {
    return CONFLICT_RESPONSE(
      "This job position already has an appraisal weight configuration. Edit it instead."
    );
  }

  const { data, error } = await supabaseAdmin
    .from("hr3_position_appraisal_weights")
    .insert({
      job_position_id: positionId,
      goal_weight: goalWeight,
      competency_weight: competencyWeight,
    })
    .select(WEIGHTS_SELECT)
    .single();

  if (error) {
    console.error("createPositionAppraisalWeights: insert error:", error);
    return NextResponse.json(
      { error: "Failed to create position appraisal weights" },
      { status: 500 }
    );
  }

  const created = data as PositionAppraisalWeights;

  const auditError = await insertAuditEvent({
    actor: auditActorFromIdentity(admin),
    reason: PERFORMANCE_AUDIT_REASON.positionAppraisalWeightsCreated,
    entityType: PERFORMANCE_AUDIT_ENTITY_TYPE.positionAppraisalWeights,
    entityId: created.id,
    oldData: null,
    newData: {
      job_position_id: created.job_position_id,
      goal_weight: created.goal_weight,
      competency_weight: created.competency_weight,
    },
  });
  if (auditError instanceof NextResponse) return auditError;

  const [enriched] = await attachPositionTitles([created]);
  return enriched;
}

export async function updatePositionAppraisalWeights(
  weightsId: string,
  input: UpdatePositionAppraisalWeightsInput
): Promise<PositionAppraisalWeightsItem | NextResponse> {
  const admin = await assertHrAdminScope();
  if (admin instanceof NextResponse) return admin;

  const id = requireValidUuid(weightsId, "weights id");
  if (id instanceof NextResponse) return id;

  const goalWeight = parseComponentWeight(input?.goal_weight, "goal_weight");
  if (goalWeight instanceof NextResponse) return goalWeight;
  const competencyWeight = parseComponentWeight(
    input?.competency_weight,
    "competency_weight"
  );
  if (competencyWeight instanceof NextResponse) return competencyWeight;

  const totalError = validateWeightTotal(goalWeight, competencyWeight);
  if (totalError) return totalError;

  const { data: existing, error: loadError } = await supabaseAdmin
    .from("hr3_position_appraisal_weights")
    .select(WEIGHTS_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    console.error("updatePositionAppraisalWeights: load error:", loadError);
    return NextResponse.json(
      { error: "Failed to load position appraisal weights" },
      { status: 500 }
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Position appraisal weights not found." },
      { status: 404 }
    );
  }

  const prev = existing as PositionAppraisalWeights;

  const { data, error } = await supabaseAdmin
    .from("hr3_position_appraisal_weights")
    .update({
      goal_weight: goalWeight,
      competency_weight: competencyWeight,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(WEIGHTS_SELECT)
    .single();

  if (error) {
    console.error("updatePositionAppraisalWeights: update error:", error);
    return NextResponse.json(
      { error: "Failed to update position appraisal weights" },
      { status: 500 }
    );
  }

  const updated = data as PositionAppraisalWeights;

  const auditError = await insertAuditEvent({
    actor: auditActorFromIdentity(admin),
    reason: PERFORMANCE_AUDIT_REASON.positionAppraisalWeightsUpdated,
    entityType: PERFORMANCE_AUDIT_ENTITY_TYPE.positionAppraisalWeights,
    entityId: updated.id,
    oldData: {
      goal_weight: prev.goal_weight,
      competency_weight: prev.competency_weight,
    },
    newData: {
      goal_weight: updated.goal_weight,
      competency_weight: updated.competency_weight,
    },
  });
  if (auditError instanceof NextResponse) return auditError;

  const [enriched] = await attachPositionTitles([updated]);
  return enriched;
}

/**
 * Resolves the scoring composition percentages for a job position, or null
 * when the position has no configuration. Internal/server use: appraisal
 * creation snapshots the resolved percentages; scoring consumes snapshots
 * (or the legacy default when absent). Percentages (not fractions) are
 * returned so snapshot storage matches configuration units exactly.
 */
export async function getWeightsForPosition(
  positionId: string
): Promise<{ goalWeightPct: number; competencyWeightPct: number } | null> {
  const { data, error } = await supabaseAdmin
    .from("hr3_position_appraisal_weights")
    .select("goal_weight, competency_weight")
    .eq("job_position_id", positionId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.error("getWeightsForPosition: query error:", error);
    }
    return null;
  }

  const goal = Number((data as { goal_weight: unknown }).goal_weight);
  const competency = Number(
    (data as { competency_weight: unknown }).competency_weight
  );
  if (!Number.isFinite(goal) || !Number.isFinite(competency)) return null;
  return { goalWeightPct: goal, competencyWeightPct: competency };
}
