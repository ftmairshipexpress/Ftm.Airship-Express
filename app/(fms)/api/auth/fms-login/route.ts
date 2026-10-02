import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/app/(fms)/lib/supabaseAdmin";
import {
    createOtp,
    LOGIN_OTP_TTL,
} from "@/app/(fms)/lib/fmsOtp";

import { sendFmsOtpEmail } from "@/app/(fms)/lib/fmsMailer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LOGIN_CHALLENGE_COOKIE = "fms_login_challenge";

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

        const employeeId = String(
            body?.employeeId || ""
        ).trim();

        const password = String(
            body?.password || ""
        );

        if (!employeeId || !password) {
            return NextResponse.json(
                {
                    message:
                        "Enter your employee ID and password to continue.",
                },
                { status: 400 }
            );
        }

        // ---------------------------------------------------------
        // 1. Find the FMS employee
        // ---------------------------------------------------------
        const {
            data: fmsUser,
            error: fmsError,
        } = await supabaseAdmin
            .from("fms_users")
            .select(
                "id, employee_id, role"
            )
            .eq("employee_id", employeeId)
            .single();

        if (fmsError || !fmsUser) {
            return NextResponse.json(
                {
                    message:
                        "Employee ID or password is incorrect.",
                },
                { status: 401 }
            );
        }

        // ---------------------------------------------------------
        // 2. Get the Supabase Auth email
        // ---------------------------------------------------------
        const {
            data: authUser,
            error: authError,
        } =
            await supabaseAdmin.auth.admin.getUserById(
                fmsUser.id
            );

        const email = authUser?.user?.email;

        if (authError || !email) {
            return NextResponse.json(
                {
                    message:
                        "Employee ID or password is incorrect.",
                },
                { status: 401 }
            );
        }

        // ---------------------------------------------------------
        // 3. Create a server Supabase client ONLY for checking
        //    the password.
        //
        //    We intentionally do NOT apply its generated
        //    authentication cookies to the response.
        // ---------------------------------------------------------
        const cookieStore = await cookies();

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_FMS_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_FMS_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll();
                    },

                    setAll() {
                        /*
                         * Intentionally ignored.
                         *
                         * signInWithPassword() may generate
                         * Supabase session cookies, but we do NOT
                         * send them to the browser yet.
                         *
                         * The real session will only be established
                         * after successful OTP verification.
                         */
                    },
                },
            }
        );

        // ---------------------------------------------------------
        // 4. Verify password
        // ---------------------------------------------------------
        const {
            data: signInData,
            error: signInError,
        } =
            await supabase.auth.signInWithPassword({
                email,
                password,
            });

        if (
            signInError ||
            !signInData.user ||
            !signInData.session
        ) {
            return NextResponse.json(
                {
                    message:
                        "Employee ID or password is incorrect.",
                },
                { status: 401 }
            );
        }

        // Make sure the authenticated Supabase user is the
        // same user associated with the FMS account.
        if (signInData.user.id !== fmsUser.id) {
            return NextResponse.json(
                {
                    message:
                        "Unable to verify the FMS account.",
                },
                { status: 403 }
            );
        }

        // ---------------------------------------------------------
        // 5. Generate login OTP
        // ---------------------------------------------------------
        const {
            otpId,
            code,
            expiresAt,
        } = await createOtp({
            userId: fmsUser.id,
            email,
            purpose: "login",
            ttlMinutes: LOGIN_OTP_TTL,
        });

        // ---------------------------------------------------------
        // 6. Send OTP to the registered email
        // ---------------------------------------------------------
        try {
            await sendFmsOtpEmail({
    to: email,
    code,
    ttlMinutes: LOGIN_OTP_TTL,
});
        } catch (mailError) {
            console.error(
                "FMS login OTP email failed:",
                mailError
            );

            /*
             * Invalidate the OTP if the email could not be sent.
             * This prevents an unsent code from remaining active.
             */
            await supabaseAdmin
                .from("fms_otp")
                .update({
                    consumed_at:
                        new Date().toISOString(),
                })
                .eq("id", otpId);

            return NextResponse.json(
                {
                    message:
                        "We could not send the verification code. Please try again.",
                },
                { status: 500 }
            );
        }

        // ---------------------------------------------------------
        // 7. Create login challenge cookie
        // ---------------------------------------------------------
        const response = NextResponse.json({
            success: true,

            requiresOtp: true,

            otp_id: otpId,

            email: maskEmail(email),

            expires_at:
                expiresAt.toISOString(),

            ttl_minutes:
                LOGIN_OTP_TTL,

            user: {
                id: fmsUser.id,
                employeeId:
                    fmsUser.employee_id,
                role: fmsUser.role,
            },

            redirectTo: "/dashboard",
        });

        response.cookies.set(
            LOGIN_CHALLENGE_COOKIE,
            otpId,
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

        return response;
    } catch (error: unknown) {
        console.error(
            "POST /api/auth/fms-login error:",
            error
        );

        return NextResponse.json(
            {
                message:
                    error instanceof Error
                        ? error.message
                        : "An unexpected error occurred during login.",
            },
            { status: 500 }
        );
    }
}