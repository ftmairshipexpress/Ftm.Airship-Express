import { NextResponse } from "next/server";
import { createClient } from "../../../library/supabase/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const email = body.email?.trim();
    const password = body.password;

    if (!email || !password) {
      return NextResponse.json(
        {
          success: false,
          error: "Email and password are required",
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Authenticate with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      console.error("Staff login error:", authError);

      return NextResponse.json(
        {
          success: false,
          error: "Invalid email or password",
        },
        { status: 401 }
      );
    }

    // Get unified profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, mfa_enabled, mfa_email_verified")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Profile error:", profileError);
      await supabase.auth.signOut();

      return NextResponse.json(
        {
          success: false,
          error: "Unable to load profile",
        },
        { status: 500 }
      );
    }

    // Make sure this is a staff account
    if (!profile || profile.role !== "staff") {
      await supabase.auth.signOut();

      return NextResponse.json(
        {
          success: false,
          error: "Staff access required",
        },
        { status: 403 }
      );
    }

    // If MFA is enabled, reset email_verified flag so MFA is required for this new session
    if (profile.mfa_enabled) {
      await supabase
        .from("profiles")
        .update({ mfa_email_verified: false })
        .eq("id", authData.user.id);

      return NextResponse.json(
        {
          success: false,
          error: "MFA_REQUIRED",
          mfaRequired: true,
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
        full_name: profile.full_name,
        role: profile.role,
        mfaEnabled: profile.mfa_enabled,
      },
      session: authData.session,
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}