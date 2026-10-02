/**
 * Competency applicability — which library competencies apply at
 * organization / department / individual scope
 * (`hr3_competency_applicability`).
 *
 * Applicability answers ONLY "which items apply". It never determines
 * scoring composition (that comes from position-weight configuration), and
 * it never writes appraisal rows: resolution is a read used by cycle
 * readiness and HR planning displays. Frozen appraisal snapshots keep
 * history stable when assignments later change.
 *
 * Departments are free-text in HR1: values are stored trimmed and matched
 * case-insensitively at resolve time (documented limitation — no external
 * department ID is invented).
 *
 * HR Admin scope only (all operations).
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
  requireValidUuid,
} from "@/performance-development-dashboard/lib/performance/validation";
import type {
  CompetencyApplicability,
  CompetencyApplicabilityInput,
  LibraryApplicabilityScope,
} from "@/performance-development-dashboard/types";

export type {
  CompetencyApplicability,
  CompetencyApplicabilityInput,
  LibraryApplicabilityScope,
} from "@/performance-development-dashboard/types";

const APPLICABILITY_SELECT =
  "id, competency_id, scope, department, employee_id, created_at, updated_at";

const APPLICABILITY_SCOPES: readonly string[] = [
  "organization",
  "department",
  "individual",
];

function normalizeDepartment(value: unknown): string | null | NextResponse {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    return BAD_REQUEST_RESPONSE("department must be a string.");
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function requireExistingCompetencyId(
  value: unknown
): Promise<string | NextResponse> {
  const id = requireValidUuid(value, "competency_id");
  if (id instanceof NextResponse) return id;

  const { data, error } = await supabaseAdmin
    .from("hr3_competencies")
    .select("id, is_active")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("applicability: competency query error:", error);
    return NextResponse.json(
      { error: "Failed to validate competency" },
      { status: 500 }
    );
  }
  if (!data) {
    return BAD_REQUEST_RESPONSE(
      "competency_id does not reference an existing competency."
    );
  }
  return id;
}

async function requireExistingEmployeeId(
  value: unknown
): Promise<string | NextResponse> {
  const id = requireValidUuid(value, "employee_id");
  if (id instanceof NextResponse) return id;

  const { data, error } = await supabaseAdmin
    .from("hr1_employees")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("applicability: employee query error:", error);
    return NextResponse.json(
      { error: "Failed to validate employee" },
      { status: 500 }
    );
  }
  if (!data) {
    return BAD_REQUEST_RESPONSE(
      "employee_id does not reference an existing employee."
    );
  }
  return id;
}

export type ListApplicabilityQuery = {
  competency_id?: string | null;
  scope?: LibraryApplicabilityScope | null;
};

export async function listCompetencyApplicability(
  query: ListApplicabilityQuery
): Promise<CompetencyApplicability[] | NextResponse> {
  const admin = await assertHrAdminScope();
  if (admin instanceof NextResponse) return admin;

  let builder = supabaseAdmin
    .from("hr3_competency_applicability")
    .select(APPLICABILITY_SELECT);

  if (query?.competency_id !== undefined && query.competency_id !== null) {
    const competencyId = requireValidUuid(
      query.competency_id,
      "competency_id"
    );
    if (competencyId instanceof NextResponse) return competencyId;
    builder = builder.eq("competency_id", competencyId);
  }

  if (query?.scope !== undefined && query.scope !== null) {
    if (!APPLICABILITY_SCOPES.includes(query.scope)) {
      return BAD_REQUEST_RESPONSE(
        "scope must be one of: organization, department, individual."
      );
    }
    builder = builder.eq("scope", query.scope);
  }

  const { data, error } = await builder
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("listCompetencyApplicability: query error:", error);
    return NextResponse.json(
      { error: "Failed to load competency applicability" },
      { status: 500 }
    );
  }

  return (data ?? []) as CompetencyApplicability[];
}

export async function createCompetencyApplicability(
  input: CompetencyApplicabilityInput
): Promise<CompetencyApplicability | NextResponse> {
  const admin = await assertHrAdminScope();
  if (admin instanceof NextResponse) return admin;

  const competencyId = await requireExistingCompetencyId(
    input?.competency_id
  );
  if (competencyId instanceof NextResponse) return competencyId;

  const scope = input?.scope;
  if (typeof scope !== "string" || !APPLICABILITY_SCOPES.includes(scope)) {
    return BAD_REQUEST_RESPONSE(
      "scope must be one of: organization, department, individual."
    );
  }

  let department: string | null = null;
  let employeeId: string | null = null;

  if (scope === "department") {
    const parsed = normalizeDepartment(input?.department);
    if (parsed instanceof NextResponse) return parsed;
    if (!parsed) {
      return BAD_REQUEST_RESPONSE(
        "department is required for department-scoped applicability."
      );
    }
    department = parsed;
  } else if (scope === "individual") {
    const parsed = await requireExistingEmployeeId(input?.employee_id);
    if (parsed instanceof NextResponse) return parsed;
    employeeId = parsed;
  } else if (input?.department != null || input?.employee_id != null) {
    return BAD_REQUEST_RESPONSE(
      "organization-scoped applicability carries neither department nor employee."
    );
  }

  // Duplicate protection (application-side: NULLs differ per scope, matching
  // the enrollment precedent).
  let duplicateQuery = supabaseAdmin
    .from("hr3_competency_applicability")
    .select("id")
    .eq("competency_id", competencyId)
    .eq("scope", scope);
  duplicateQuery =
    department !== null
      ? duplicateQuery.eq("department", department)
      : duplicateQuery.is("department", null);
  duplicateQuery =
    employeeId !== null
      ? duplicateQuery.eq("employee_id", employeeId)
      : duplicateQuery.is("employee_id", null);

  const { data: duplicate, error: duplicateError } = await duplicateQuery
    .limit(1)
    .maybeSingle();

  if (duplicateError) {
    console.error(
      "createCompetencyApplicability: duplicate query error:",
      duplicateError
    );
    return NextResponse.json(
      { error: "Failed to validate competency applicability" },
      { status: 500 }
    );
  }
  if (duplicate) {
    return CONFLICT_RESPONSE(
      "This competency already has an identical applicability assignment."
    );
  }

  const { data, error } = await supabaseAdmin
    .from("hr3_competency_applicability")
    .insert({
      competency_id: competencyId,
      scope,
      department,
      employee_id: employeeId,
    })
    .select(APPLICABILITY_SELECT)
    .single();

  if (error) {
    console.error("createCompetencyApplicability: insert error:", error);
    return NextResponse.json(
      { error: "Failed to create competency applicability" },
      { status: 500 }
    );
  }

  const created = data as CompetencyApplicability;

  const auditError = await insertAuditEvent({
    actor: auditActorFromIdentity(admin),
    reason: PERFORMANCE_AUDIT_REASON.competencyApplicabilityCreated,
    entityType: PERFORMANCE_AUDIT_ENTITY_TYPE.competencyApplicability,
    entityId: created.id,
    oldData: null,
    newData: {
      competency_id: created.competency_id,
      scope: created.scope,
      department: created.department,
      employee_id: created.employee_id,
    },
  });
  if (auditError instanceof NextResponse) return auditError;

  return created;
}

export async function deleteCompetencyApplicability(
  applicabilityId: string
): Promise<NextResponse> {
  const admin = await assertHrAdminScope();
  if (admin instanceof NextResponse) return admin;

  const id = requireValidUuid(applicabilityId, "applicability id");
  if (id instanceof NextResponse) return id;

  const { data: existing, error: loadError } = await supabaseAdmin
    .from("hr3_competency_applicability")
    .select(APPLICABILITY_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    console.error("deleteCompetencyApplicability: load error:", loadError);
    return NextResponse.json(
      { error: "Failed to load competency applicability" },
      { status: 500 }
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Competency applicability not found." },
      { status: 404 }
    );
  }

  const row = existing as CompetencyApplicability;

  const { error } = await supabaseAdmin
    .from("hr3_competency_applicability")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("deleteCompetencyApplicability: delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete competency applicability" },
      { status: 500 }
    );
  }

  const auditError = await insertAuditEvent({
    actor: auditActorFromIdentity(admin),
    reason: PERFORMANCE_AUDIT_REASON.competencyApplicabilityDeleted,
    entityType: PERFORMANCE_AUDIT_ENTITY_TYPE.competencyApplicability,
    entityId: id,
    oldData: {
      competency_id: row.competency_id,
      scope: row.scope,
      department: row.department,
      employee_id: row.employee_id,
    },
    newData: null,
  });
  if (auditError instanceof NextResponse) return auditError;

  return NextResponse.json({ success: true });
}

/**
 * Resolves the active applicable competency IDs for one employee.
 * Precedence is display-only ordering (individual, department,
 * organization); results dedupe by competency id. Inactive competencies
 * never resolve. Read-only: frozen appraisal snapshots keep history stable
 * when assignments later change.
 */
export async function resolveCompetencyApplicability(input: {
  employeeId: string;
  department: string | null;
}): Promise<{ competencyIds: string[] } | NextResponse> {
  const { data: assignments, error: assignmentsError } = await supabaseAdmin
    .from("hr3_competency_applicability")
    .select("competency_id, scope, department, employee_id")
    .or(
      [
        "scope.eq.organization",
        input.department
          ? `and(scope.eq.department,department.ilike.${escapeIlike(
              input.department
            )})`
          : null,
        `and(scope.eq.individual,employee_id.eq.${input.employeeId})`,
      ]
        .filter((clause): clause is string => clause !== null)
        .join(",")
    );

  if (assignmentsError) {
    console.error(
      "resolveCompetencyApplicability: assignments query error:",
      assignmentsError
    );
    return NextResponse.json(
      { error: "Failed to resolve competency applicability" },
      { status: 500 }
    );
  }

  const candidateIds = [
    ...new Set(
      ((assignments ?? []) as { competency_id: string }[]).map(
        (row) => row.competency_id
      )
    ),
  ];
  if (candidateIds.length === 0) return { competencyIds: [] };

  const { data: competencies, error: competenciesError } = await supabaseAdmin
    .from("hr3_competencies")
    .select("id")
    .in("id", candidateIds)
    .eq("is_active", true);

  if (competenciesError) {
    console.error(
      "resolveCompetencyApplicability: competency query error:",
      competenciesError
    );
    return NextResponse.json(
      { error: "Failed to resolve competency applicability" },
      { status: 500 }
    );
  }

  return {
    competencyIds: ((competencies ?? []) as { id: string }[]).map(
      (row) => row.id
    ),
  };
}

/** Escapes PostgREST ilike special characters in a department value. */
function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, (char) => `\\${char}`);
}
