import { SupabaseClient } from "@supabase/supabase-js";
import { SLA_TIERS } from "../../services/delivery-policy";


type DeliveryPolicyInput = {
  policy: string;
  coverage: string;
  region?: unknown;
  minDays: number;
  maxDays: number;
};

export function validatePolicyInput(data: DeliveryPolicyInput) {
  const { policy, coverage, region, minDays, maxDays } = data;

  if (!policy || typeof policy !== "string") {
    return "Policy name is required.";
  }

  if (!coverage || typeof coverage !== "string") {
    return "Coverage is required.";
  }

  // A policy without a tier is invisible to SLA evaluation, so it cannot be
  // saved. Only the two confirmed tiers are accepted — there is no "Unknown".
  if (typeof region !== "string" || !(SLA_TIERS as readonly string[]).includes(region)) {
    return `Region is required and must be one of: ${SLA_TIERS.join(", ")}.`;
  }

  if (!Number.isFinite(minDays) || !Number.isFinite(maxDays)) {
    return "Min and max days must be numbers.";
  }

  if (minDays < 1 || maxDays < 1) {
    return "Days must be at least 1.";
  }

  if (minDays > maxDays) {
    return "Min day can't be greater than max day.";
  }

  return null;
}

export function validateId(id: unknown) {
  if (!id || typeof id !== "string") {
    return "ID is required.";
  }

  return null;
}

export async function getAuthenticatedClient(createClient: () => Promise<SupabaseClient>) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  return supabase;
}


export async function getStaffClient(createClient: () => Promise<SupabaseClient>) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { client: null, error: "Unauthorized" as const };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "staff") {
    return { client: null, error: "Forbidden" as const };
  }

  return { client: supabase, error: null };
}
