import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { supabaseAdmin } from "@/app/(fms)/lib/supabaseAdmin";
import {
    createOtp,
    getActiveLock,
    LOGIN_OTP_TTL,
} from "@/app/(fms)/lib/fmsOtp";

import { sendFmsOtpEmail } from "@/app/(fms)/lib/fmsMailer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LOGIN_CHALLENGE_COOKIE = "fms_login_challenge";
const RESEND_COOLDOWN_SECONDS = 30;

function maskEmail(email: string): string {
    const [local, domain] = email.split("@");

    if (!local || !domain) {
        return "your registered email";
    }

    if (local.length <= 2) {
        return `${local[0] ?? "*"}***@${domain}`;
    }

    return `${local[0]}${"*".repeat(
        Math.max(2, local.length - 2)
    )}${local[local.length - 1]}@${domain}`;
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const otpId = String(
            body?.otp_id || ""
        ).trim();

        if (!otpId) {
            return NextResponse.json(
                {
                    message:
                        "Login verification request is missing.",
                },
                { status: 400 }
            );
        }

        const cookieStore = await cookies();

        /*
         * The fms-login route will create this cookie after
         * successfully validating the employee's password.
         *
         * This prevents someone from using a random OTP ID
         * to trigger resend requests.
         */
        const challengeCookie =
            cookieStore.get(
                LOGIN_CHALLENGE_COOKIE
            )?.value;

        if (
            !challengeCookie ||
            challengeCookie !== otpId
        ) {
            return NextResponse.json(
                {
                    message:
                        "The login verification session is invalid or expired.",
                },
                { status: 401 }
            );
        }

        /*
         * Find the current pending login OTP.
         */
        const {
            data: currentOtp,
            error: otpLookupError,
        } = await supabaseAdmin
            .from("fms_otp")
            .select(
                "id, user_id, email, created_at, expires_at"
            )
            .eq("id", otpId)
            .eq("purpose", "login")
            .is("consumed_at", null)
            .maybeSingle();

        if (
            otpLookupError ||
            !currentOtp
        ) {
            return NextResponse.json(
                {
                    message:
                        "The verification request could not be found. Please sign in again.",
                },
                { status: 400 }
            );
        }

        /*
         * Check account-level OTP lock.
         */
        const lock = await getActiveLock(
            currentOtp.user_id
        );

        if (lock.locked) {
            return NextResponse.json(
                {
                    message: `Too many incorrect attempts. Try again in ${lock.minutesLeft} minute(s).`,
                    locked: true,
                    minutes_left:
                        lock.minutesLeft,
                },
                { status: 429 }
            );
        }

        /*
         * Server-side resend cooldown.
         */
        const createdAt = new Date(
            currentOtp.created_at
        ).getTime();

        const elapsedSeconds = Math.floor(
            (Date.now() - createdAt) / 1000
        );

        if (
            elapsedSeconds <
            RESEND_COOLDOWN_SECONDS
        ) {
            const retryAfter =
                RESEND_COOLDOWN_SECONDS -
                elapsedSeconds;

            return NextResponse.json(
                {
                    message: `Please wait ${retryAfter} second(s) before requesting another code.`,
                    retry_after: retryAfter,
                },
                { status: 429 }
            );
        }

        /*
         * Generate a new OTP.
         *
         * createOtp() invalidates the previous unused code
         * for this user/purpose.
         */
        const {
            otpId: newOtpId,
            code,
            expiresAt,
        } = await createOtp({
            userId: currentOtp.user_id,
            email: currentOtp.email,
            purpose: "login",
            ttlMinutes: LOGIN_OTP_TTL,
        });

        /*
         * Reuse the existing Airship Express OTP mailer.
         */
      await sendFmsOtpEmail({
    to: currentOtp.email,
    code,
    ttlMinutes: LOGIN_OTP_TTL,
    });

        /*
         * Bind the new OTP to this login challenge.
         */
        cookieStore.set(
            LOGIN_CHALLENGE_COOKIE,
            newOtpId,
            {
                httpOnly: true,
                secure:
                    process.env.NODE_ENV ===
                    "production",
                sameSite: "strict",
                path: "/",
                maxAge:
                    LOGIN_OTP_TTL * 60,
            }
        );

        return NextResponse.json({
            success: true,
            otp_id: newOtpId,
            email: maskEmail(
                currentOtp.email
            ),
            expires_at:
                expiresAt.toISOString(),
            ttl_minutes:
                LOGIN_OTP_TTL,
            cooldown_seconds:
                RESEND_COOLDOWN_SECONDS,
        });
    } catch (error: unknown) {
        console.error(
            "POST /api/auth/fms-login/otp/send error:",
            error
        );

        return NextResponse.json(
            {
                message:
                    error instanceof Error
                        ? error.message
                        : "Failed to resend OTP.",
            },
            { status: 500 }
        );
    }
}