import { NextResponse } from "next/server";
import { createClient } from "@/app/(crbc)/library/supabase/server";
import { verifyMfaCode, disableMfa, enableMfaWithPassword } from "@/app/(crbc)/actions/mfa";

/** OTP must be exactly 6 digits, 0-9 only. */
const OTP_PATTERN = /^[0-9]{6}$/;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const purpose = body.purpose === "disable" ? "disable" : "login";
    const action = body.action; // "disable" | "verify" | "enable_with_password"

    // Get authenticated session user FIRST - this is the source of truth
    const supabase = await createClient();
    const {
      data: { user: sessionUser },
      error: sessionError,
    } = await supabase.auth.getUser();

    if (sessionError || !sessionUser) {
      return NextResponse.json(
        { success: false, error: "Session expired. Please log in again." },
        { status: 401 }
      );
    }

    // Enable MFA: PASSWORD ONLY. No OTP/code is accepted on this path.
    if (action === "enable_with_password") {
      const password = body.password;
      if (!password) {
        return NextResponse.json(
          { success: false, error: "Password is required" },
          { status: 400 }
        );
      }

      const result = await enableMfaWithPassword(sessionUser.id, password);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    // Disable MFA: requires BOTH password and 6-digit OTP
    if (action === "disable") {
      const password = body.password;

      if (!OTP_PATTERN.test(code)) {
        return NextResponse.json(
          { success: false, error: "Enter the 6-digit code" },
          { status: 400 }
        );
      }
      if (!password) {
        return NextResponse.json(
          { success: false, error: "Password required to disable MFA" },
          { status: 400 }
        );
      }

      const result = await disableMfa(sessionUser.id, code, password);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    // Login verification - validate the code format before hitting the store
    if (!OTP_PATTERN.test(code)) {
      return NextResponse.json(
        { success: false, error: "Enter the 6-digit code" },
        { status: 400 }
      );
    }

    const result = await verifyMfaCode(sessionUser.id, code, purpose);

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    // On successful login verification, update mfa_email_verified and mfa_last_used_at
    await supabase
      .from("profiles")
      .update({
        mfa_email_verified: true,
        mfa_last_used_at: new Date().toISOString(),
      })
      .eq("id", sessionUser.id);

    // Get profile for redirect
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", sessionUser.id)
      .single();

    return NextResponse.json({
      success: true,
      redirectTo: profile?.role === "staff" ? "/crbc/dashboard" : "/customer/dashboard",
    });
  } catch (error) {
    console.error("MFA verify error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}