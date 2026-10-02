import { createClient } from "../supabase/server";
import type { User } from "@supabase/supabase-js";
import type { Customers } from "../../types/customer";

export type CurrentUser = {
  authUser: User;
  profile: {
    id: string;
    email: string;
    full_name: string | null;
    role: "staff" | "customer";
    mfa_enabled: boolean;
    mfa_email_verified: boolean;
  };
  customer: Customers | null;
} | null;

export async function getCurrentUser(): Promise<CurrentUser> {
  const supabase = await createClient();

  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authUser) {
    return null;
  }

  // Fetch unified profile (auth metadata)
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, mfa_enabled, mfa_email_verified")
    .eq("id", authUser.id)
    .single();

  if (profileError || !profile) {
    return null;
  }

  // Fetch customer business data (if customer role)
  let customer: Customers | null = null;
  if (profile.role === "customer") {
    // First try profile_id (new schema)
    const { data: custData, error: custError } = await supabase
      .from("customers")
      .select("*")
      .eq("profile_id", authUser.id)
      .maybeSingle();

    // Fallback to auth_user_id (legacy migration)
    if (custError || !custData) {
      const { data: custDataLegacy, error: custErrorLegacy } = await supabase
        .from("customers")
        .select("*")
        .eq("auth_user_id", authUser.id)
        .maybeSingle();

      if (!custErrorLegacy && custDataLegacy) {
        customer = custDataLegacy as Customers;
      }
    } else if (!custError && custData) {
      customer = custData as Customers;
    }
  }

  return {
    authUser,
    profile: {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      role: profile.role as "staff" | "customer",
      mfa_enabled: profile.mfa_enabled,
      mfa_email_verified: profile.mfa_email_verified,
    },
    customer,
  };
}