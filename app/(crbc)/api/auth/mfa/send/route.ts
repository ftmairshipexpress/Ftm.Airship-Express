import { NextResponse } from "next/server";
import { createClient } from "@/app/(crbc)/library/supabase/server";
import { sendMfaCode } from "@/app/(crbc)/actions/mfa";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Get user from session for security
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

    const body = await request.json();
    const purpose = body.purpose === "disable" ? "disable" : "login";

    // sessionUser.id is the source of truth - never trust the request email
    const result = await sendMfaCode(sessionUser.id, purpose);

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("MFA send error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}