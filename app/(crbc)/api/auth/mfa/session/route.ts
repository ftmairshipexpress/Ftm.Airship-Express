import { NextResponse } from "next/server";
import { createClient } from "@/app/(crbc)/library/supabase/server";

export async function POST() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      // No active session
      return NextResponse.json({ success: false, redirectTo: "login" });
    }

    // Get profile for MFA check
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role, mfa_enabled, mfa_email_verified")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ success: false, redirectTo: "login" });
    }

    // If MFA is not enabled, user should not be here
    if (!profile.mfa_enabled) {
      return NextResponse.json({ success: false, redirectTo: "dashboard" });
    }

    // If MFA already verified in this session
    if (profile.mfa_email_verified) {
      return NextResponse.json({ success: false, redirectTo: "dashboard" });
    }

    // Valid MFA challenge - user has MFA enabled but not verified
    return NextResponse.json({
      success: true,
      user: {
        email: user.email,
      },
    });
  } catch (error) {
    console.error("MFA session check error:", error);
    return NextResponse.json({ success: false, redirectTo: "login" });
  }
}