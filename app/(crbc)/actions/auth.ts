"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../library/supabase/server";
import { bootstrapPortalCustomer } from "../library/auth/bootstrap-customer";

export const login = async (formData: FormData) => {
  const supabase = await createClient();

  const data = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  };

  const { error, data: authData } = await supabase.auth.signInWithPassword(data);
  if (error) {
    return { error: error.message };
  }

  // Fetch unified profile
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, mfa_enabled, mfa_email_verified")
    .eq("id", authData.user.id)
    .single();

  if (profileError || !profile) {
    if (authData.user.email_confirmed_at) {
      const healed = await bootstrapPortalCustomer();
      if (healed.ok) {
        const { data: healedProfile } = await supabase
          .from("profiles")
          .select("role, mfa_enabled, mfa_email_verified")
          .eq("id", authData.user.id)
          .single();

        if (healedProfile) {
          return routeAuthenticatedUser(supabase, authData.user.id, healedProfile);
        }
      }
    }

    await supabase.auth.signOut();
    return { error: "Account not configured. Contact administrator." };
  }

  return routeAuthenticatedUser(supabase, authData.user.id, profile);
};

/**
 * Role/MFA routing for an authenticated user that has a profile.
 */
async function routeAuthenticatedUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  profile: {
    role: string;
    mfa_enabled: boolean;
    mfa_email_verified: boolean;
  }
) {
  if (profile.role === "staff" && profile.mfa_enabled && !profile.mfa_email_verified) {
    await supabase
      .from("profiles")
      .update({ mfa_email_verified: false })
      .eq("id", userId);

    revalidatePath("/", "layout");
    redirect("/crbcAuth/mfa");
  }

  if (profile.role === "customer" && profile.mfa_enabled && !profile.mfa_email_verified) {
    await supabase
      .from("profiles")
      .update({ mfa_email_verified: false })
      .eq("id", userId);

    revalidatePath("/", "layout");
    redirect("/customerportalAuth/mfa");
  }

  // Role-based redirect
  const redirectTo = profile.role === "staff" ? "/crbc/dashboard" : "/customer/dashboard";
  revalidatePath("/", "layout");
  redirect(redirectTo);
}


// Aliases for backward compatibility
export const customerServiceLogin = login;
export const customerLogin = login;


export const signUp = async (formData: FormData) => {
  const supabase = await createClient();

  const data = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
    name: formData.get("name") as string,
  };

  if (!data.email || !data.password || !data.name) {
    return { error: "All fields are required" };
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(data.email)) {
    return { error: "Invalid email format" };
  }

  // Validate password strength
  if (data.password.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        full_name: data.name,
      },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/customerportalAuth/confirm`,
    },
  });

  if (authError) {
    return { error: authError.message };
  }

  if (!authData.user) {
    return { error: "Failed to create user account" };
  }


  revalidatePath("/", "layout");

  if (!authData.session) {
    redirect("/customerportalAuth/verify-email");
  }

  const result = await bootstrapPortalCustomer(data.name);

  if (!result.ok) {
    console.error("Sign-up bootstrap error:", result.error);
    return {
      error:
        "Account created, but setup did not complete. " +
        "Please confirm your email to finish registration.",
    };
  }

  redirect("/customer/dashboard");
};

export const logout = async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let redirectTo = "/";

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.role === "customer") {
      redirectTo = "/customerportalAuth/login";
    } else if (profile?.role === "staff") {
      redirectTo = "/crbcAuth/login";
    }
  }

  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect(redirectTo);
};