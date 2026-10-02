import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { supabaseAdmin } from "@/app/(fms)/lib/supabaseAdmin";
import {
    createSession,
    verifyOtp,
    OTP_SESSION,
} from "@/app/(fms)/lib/fmsOtp";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LOGIN_CHALLENGE_COOKIE = "fms_login_challenge";

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const otpId = String(
            body?.otp_id || ""
        ).trim();

        const code = String(
            body?.code || ""
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

        if (!/^\d{6}$/.test(code)) {
            return NextResponse.json(
                {
                    message:
                        "Enter the 6-digit verification code.",
                },
                { status: 400 }
            );
        }

        const cookieStore = await cookies();

        /*
         * Make sure the OTP belongs to the current
         * login challenge.
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
                        "The login verification session is invalid or expired. Please sign in again.",
                },
                { status: 401 }
            );
        }

        /*
         * Find the user attached to this OTP.
         *
         * We do this before verifyOtp() because the
         * browser has not established a Supabase session yet.
         */
        const {
            data: otpRecord,
            error: otpLookupError,
        } = await supabaseAdmin
            .from("fms_otp")
            .select(
                "id, user_id, email"
            )
            .eq("id", otpId)
            .eq("purpose", "login")
            .is("consumed_at", null)
            .maybeSingle();

        if (
            otpLookupError ||
            !otpRecord
        ) {
            return NextResponse.json(
                {
                    message:
                        "The verification code is invalid or has already been used.",
                },
                { status: 400 }
            );
        }

        /*
         * Verify the OTP itself.
         */
        const result = await verifyOtp({
            userId: otpRecord.user_id,
            otpId,
            purpose: "login",
            code,
        });

        if (!result.ok) {
            switch (result.reason) {
                case "locked":
                    return NextResponse.json(
                        {
                            message: `Too many incorrect attempts. Try again in ${result.minutesLeft ?? 5} minute(s).`,
                            locked: true,
                            minutes_left:
                                result.minutesLeft ??
                                5,
                        },
                        { status: 429 }
                    );

                case "too_many_attempts":
                    return NextResponse.json(
                        {
                            message:
                                "Too many incorrect attempts. Please request a new code.",
                            locked: true,
                            minutes_left:
                                result.minutesLeft ??
                                5,
                        },
                        { status: 429 }
                    );

                case "expired":
                    return NextResponse.json(
                        {
                            message:
                                "This verification code has expired. Request a new code.",
                        },
                        { status: 400 }
                    );

                case "no_active_code":
                    return NextResponse.json(
                        {
                            message:
                                "No active verification code was found. Request a new code.",
                        },
                        { status: 400 }
                    );

                case "database_error":
                    return NextResponse.json(
                        {
                            message:
                                "A server error occurred while verifying the code.",
                        },
                        { status: 500 }
                    );

                case "invalid_code":
                default:
                    return NextResponse.json(
                        {
                            message:
                                "Incorrect verification code.",
                        },
                        { status: 400 }
                    );
            }
        }

        /*
         * OTP is now verified.
         *
         * This DOES NOT establish the Supabase Auth session.
         * Instead, create a short-lived login verification
         * session that the final fms-login request will consume.
         */
        const session =
            await createSession(
                otpRecord.user_id,
                "login"
            );

        /*
         * The OTP challenge has completed.
         * Remove the challenge cookie.
         */
        cookieStore.set(
            LOGIN_CHALLENGE_COOKIE,
            "",
            {
                httpOnly: true,
                secure:
                    process.env.NODE_ENV ===
                    "production",
                sameSite: "strict",
                path: "/",
                maxAge: 0,
            }
        );

        return NextResponse.json({
            success: true,
            session_token:
                session.token,
            scope: "login",
            expires_at:
                session.expiresAt.toISOString(),
            session_minutes:
                OTP_SESSION,
        });
    } catch (error: unknown) {
        console.error(
            "POST /api/auth/fms-login/otp/verify error:",
            error
        );

        return NextResponse.json(
            {
                message:
                    error instanceof Error
                        ? error.message
                        : "Failed to verify OTP.",
            },
            { status: 500 }
        );
    }
}