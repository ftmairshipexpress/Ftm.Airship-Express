import { redirect } from "next/navigation";
import { createClient } from "../supabase/server";

type RequiredRole = "customer" | "staff";

export async function protectRoute(requiredRole: RequiredRole) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      requiredRole === "staff"
        ? "/crbcAuth/login"
        : "/customerportalAuth/login"
    );
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, mfa_enabled, mfa_email_verified")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile) {
    redirect(
      requiredRole === "staff"
        ? "/crbcAuth/login"
        : "/customerportalAuth/login"
    );
  }

  // Wrong role
  if (profile.role !== requiredRole) {
    if (profile.role === "staff") {
      redirect("/crbc");
    }
    if (profile.role === "customer") {
      redirect("/customer/dashboard");
    }
    redirect(
      requiredRole === "staff"
        ? "/crbcAuth/login"
        : "/customerportalAuth/login"
    );
  }

  if (profile.mfa_enabled && !profile.mfa_email_verified) {
    redirect(
      requiredRole === "staff"
        ? "/crbcAuth/mfa"
        : "/customerportalAuth/mfa"
    );
  }

  return {
    user,
    profile,
  };
}