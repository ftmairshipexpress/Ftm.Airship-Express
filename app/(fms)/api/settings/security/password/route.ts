import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import nodemailer from "nodemailer";
import { supabaseAdmin } from "@/app/(fms)/lib/supabaseAdmin";
import { createOtp, getActiveLock, verifyOtp } from "@/app/(fms)/lib/fmsOtp";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function getFmsMailer() {
  const user = process.env.GMAIL_FMS_USER;
  const pass = process.env.GMAIL_FMS_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error("FMS mailer credentials are not configured.");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

async function getCurrentUser() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_FMS_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_FMS_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Route handlers may not always allow cookie mutation here.
          }
        },
      },
    }
  );

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  const { data: fmsUser } = await supabaseAdmin
    .from("fms_users")
    .select("id, employee_id, role, Email")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    id: data.user.id,
    email: data.user.email ?? fmsUser?.Email ?? "",
    employeeId: fmsUser?.employee_id ?? "",
    role: fmsUser?.role ?? "staff",
  };
}

function otpEmailHtml(code: string) {
  return `
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c1b1f">
      <div style="border-bottom:2px solid #e5167e;padding-bottom:12px;margin-bottom:20px">
        <h1 style="margin:0;font-size:20px;color:#1c1b1f">Airship Express</h1>
        <p style="margin:4px 0 0;font-size:12px;color:#6b6b76">Password Change Verification</p>
      </div>
      <p style="margin:0 0 16px;font-size:14px">Hello,</p>
      <p style="margin:0 0 16px;font-size:14px;color:#555">
        Use the verification code below to authorize your FMS password change:
      </p>
      <p style="margin:0 0 16px;font-family:Consolas,monospace;font-size:26px;font-weight:700;letter-spacing:5px;color:#e5167e;text-align:center">${code}</p>
      <p style="margin:0 0 16px;font-size:13px;color:#555">
        This verification code expires after a short period. Do not share it with anyone.
      </p>
      <p style="margin:24px 0 0;color:#8a8a93;font-size:11px;border-top:1px solid #eee;padding-top:16px">
        Airship Express · Binondo, Manila, Philippines<br>
        This is an automated security message. Do not reply to this email.
      </p>
    </div>
  `;
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user || !user.email) {
      return NextResponse.json(
        { error: "Your FMS session has expired. Please sign in again." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const action = body?.action;

    if (action === "send") {
      const lock = await getActiveLock(user.id);

      if (lock.locked) {
        return NextResponse.json(
          {
            error: `Too many incorrect OTP attempts. Try again in ${lock.minutesLeft} minute(s).`,
          },
          { status: 429 }
        );
      }

      const { otpId, code } = await createOtp({
        userId: user.id,
        email: user.email,
        purpose: "change_password",
      });

      const transporter = getFmsMailer();
      const from = process.env.GMAIL_FMS_USER;

      await transporter.sendMail({
        from: `"Airship Express FMS" <${from}>`,
        to: user.email,
        replyTo: from,
        subject: "Airship Express FMS — Password Change Verification",
        text: `Your Airship Express FMS password change verification code is ${code}. Do not share this code with anyone.`,
        html: otpEmailHtml(code),
      });

      return NextResponse.json({
        success: true,
        otp_id: otpId,
      });
    }

    if (action === "verify") {
      const otpId = String(body?.otp_id ?? "");
      const code = String(body?.code ?? "").trim();
      const newPassword = String(body?.new_password ?? "");

      if (!otpId || !/^\d{6}$/.test(code)) {
        return NextResponse.json(
          { error: "Enter the 6-digit verification code." },
          { status: 400 }
        );
      }

      if (newPassword.length < 8) {
        return NextResponse.json(
          { error: "Password must be at least 8 characters." },
          { status: 400 }
        );
      }

      const verification = await verifyOtp({
        userId: user.id,
        otpId,
        purpose: "change_password",
        code,
      });

      if (!verification.ok) {
        const errors: Record<string, string> = {
          locked: "Too many incorrect attempts. Please try again later.",
          no_active_code: "That verification code is no longer active. Request a new code.",
          expired: "That verification code has expired. Request a new code.",
          too_many_attempts: "Too many incorrect attempts. Please request a new code.",
          invalid_code: "The verification code is incorrect.",
          database_error: "Unable to verify the code right now. Please try again.",
        };

        return NextResponse.json(
          {
            error: errors[verification.reason ?? "database_error"] ?? "Verification failed.",
          },
          { status: verification.reason === "locked" ? 429 : 400 }
        );
      }

      const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        password: newPassword,
      });

      if (error) {
        return NextResponse.json(
          { error: error.message || "Unable to update the password." },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "Invalid security action." },
      { status: 400 }
    );
  } catch (error) {
    console.error("FMS change password error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
