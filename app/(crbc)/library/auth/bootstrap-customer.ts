import { createClient } from "../supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";


export type BootstrapResult =
  | { ok: true; profileId: string; customerId: string }
  | { ok: false; error: "no_session" | "profile_failed" | "customer_failed" };


async function ensureProfile(
  supabase: SupabaseClient,
  userId: string,
  email: string | null,
  fullName: string | null
): Promise<{ ok: true } | { ok: false; error: "profile_failed" }> {
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (existing) return { ok: true };

  const { error } = await supabase.from("profiles").insert({
    id: userId,
    email,
    full_name: fullName,
    role: "customer",
    mfa_enabled: false,
    mfa_email_verified: false,
    mfa_backup_codes: [],
    mfa_otp_sent_count: 0,
  });

  if (error) {
    // A concurrent run may have won. Re-read before failing.
    const { data: retry } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (retry) return { ok: true };
    return { ok: false, error: "profile_failed" };
  }

  return { ok: true };
}

async function ensureCustomer(
  supabase: SupabaseClient,
  userId: string,
  email: string | null,
  fullName: string | null
): Promise<
  { ok: true; customerId: string } | { ok: false; error: "customer_failed" }
> {
  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (existing) return { ok: true, customerId: existing.id };

  const { data, error } = await supabase
    .from("customers")
    .insert({
      full_name: fullName ?? email ?? "Customer",
      email,
      auth_user_id: userId,
      profile_id: userId,
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    // auth_user_id is UNIQUE, so a duplicate here means the row now exists.
    const { data: retry } = await supabase
      .from("customers")
      .select("id")
      .eq("auth_user_id", userId)
      .maybeSingle();

    if (retry) return { ok: true, customerId: retry.id };
    return { ok: false, error: "customer_failed" };
  }

  return { ok: true, customerId: data.id };
}

/**
 * Ensure both rows exist for a signed-in user. Idempotent.
 *
 * @param fullNameHint used only when the auth user has no full_name metadata.
 */
export async function bootstrapPortalCustomer(fullNameHint?: string): Promise<BootstrapResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, error: "no_session" };
  }

  const email: string | null = user.email ?? null;
  const rawName = user.user_metadata?.full_name;
  const fullName: string | null =
    (typeof rawName === "string" && rawName.trim() ? rawName.trim() : null) ??
    (fullNameHint?.trim() || null) ??
    email;

  const profile = await ensureProfile(supabase, user.id, email, fullName);
  if (!profile.ok) {
    return { ok: false, error: "profile_failed" };
  }

  const customer = await ensureCustomer(supabase, user.id, email, fullName);
  if (!customer.ok) {
    return { ok: false, error: "customer_failed" };
  }

  return { ok: true, profileId: user.id, customerId: customer.customerId };
}
