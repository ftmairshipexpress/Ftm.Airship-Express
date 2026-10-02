import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { logAuditEvent } from "../../../lib/audit";
import { getSupabaseClient } from "../../../lib/supabase";
import { createSessionToken, SESSION_COOKIE_NAME } from "../../../lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const { idNumber, password } = await req.json();

    const trimmedId = typeof idNumber === "string" ? idNumber.trim() : "";

    if (!trimmedId || !password) {
      return NextResponse.json(
        { message: "Employee ID and password are required." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("id_number", trimmedId)
      .maybeSingle();

    // A database problem (bad key, RLS, missing table, network) is NOT a wrong password.
    // Return 500 so it isn't hidden behind "Invalid Employee ID or password."
    if (error) {
      console.error("Login: Supabase query failed:", error);
      return NextResponse.json(
        { message: "Unable to verify credentials right now. Please try again." },
        { status: 500 }
      );
    }

    // Same message for unknown ID and wrong password so IDs can't be probed.
    if (!user || !user.password) {
      return NextResponse.json(
        { message: "Invalid Employee ID or password." },
        { status: 401 }
      );
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return NextResponse.json(
        { message: "Invalid Employee ID or password." },
        { status: 401 }
      );
    }

    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    });

    // Audit logging should never block a valid login.
    try {
      await logAuditEvent({
        eventType: "login",
        actorId: user.id,
        actorName: user.full_name,
        actorRole: user.role,
        action: `${user.full_name} (${user.id_number}) logged in`,
        request: req,
      });
    } catch (auditErr) {
      console.error("Login: audit log failed (login continues):", auditErr);
    }

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        id_number: user.id_number,
      },
    });

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      // Secure cookies are dropped over plain http (except on localhost in most browsers).
      // If you run a production build over http (e.g. an internal IP), set COOKIE_SECURE=false.
      secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (err) {
    console.error("Login API error:", err);
    return NextResponse.json({ message: "Internal server error." }, { status: 500 });
  }
}