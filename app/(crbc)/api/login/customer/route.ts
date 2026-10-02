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
      console.error("Customer login error:", authError);

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

    // Make sure this is a customer account
    if (!profile || profile.role !== "customer") {
      await supabase.auth.signOut();

      return NextResponse.json(
        {
          success: false,
          error: "Customer access required",
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

    // Get customer business data
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("*")
      .eq("profile_id", authData.user.id)
      .single();

    return NextResponse.json({
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
        role: profile.role,
        mfaEnabled: profile.mfa_enabled,
      },
      customer: customer || null,
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