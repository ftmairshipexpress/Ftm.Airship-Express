import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/app/(fms)/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const employeeId = String(
            body?.employeeId || ""
        ).trim();

        const password = String(
            body?.password || ""
        );

        const loginVerificationToken = String(
            body?.loginVerificationToken || ""
        ).trim();

        if (
            !employeeId ||
            !password ||
            !loginVerificationToken
        ) {
            return NextResponse.json(
                {
                    message:
                        "Login verification could not be completed.",
                },
                { status: 400 }
            );
        }

        // ---------------------------------------------------------
        // 1. Find the temporary OTP login session
        // ---------------------------------------------------------
        const {
            data: otpSession,
            error: otpSessionError,
        } = await supabaseAdmin
            .from("fms_otp_session")
            .select(
                "user_id, scope, expires_at"
            )
            .eq(
                "token",
                loginVerificationToken
            )
            .maybeSingle();

        if (
            otpSessionError ||
            !otpSession
        ) {
            return NextResponse.json(
                {
                    message:
                        "The login verification has expired. Please sign in again.",
                },
                { status: 401 }
            );
        }

        if (
            otpSession.scope !== "login" ||
            new Date(
                otpSession.expires_at
            ).getTime() <= Date.now()
        ) {
            await supabaseAdmin
                .from("fms_otp_session")
                .delete()
                .eq(
                    "token",
                    loginVerificationToken
                );

            return NextResponse.json(
                {
                    message:
                        "The login verification has expired. Please sign in again.",
                },
                { status: 401 }
            );
        }

        // ---------------------------------------------------------
        // 2. Confirm that the employee ID belongs to the
        //    verified OTP user
        // ---------------------------------------------------------
        const {
            data: fmsUser,
            error: fmsUserError,
        } = await supabaseAdmin
            .from("fms_users")
            .select(
                "id, employee_id, role"
            )
            .eq(
                "id",
                otpSession.user_id
            )
            .eq(
                "employee_id",
                employeeId
            )
            .maybeSingle();

        if (
            fmsUserError ||
            !fmsUser
        ) {
            return NextResponse.json(
                {
                    message:
                        "The login verification does not match this employee account.",
                },
                { status: 403 }
            );
        }

        // ---------------------------------------------------------
        // 3. Get the Supabase Auth email
        // ---------------------------------------------------------
        const {
            data: authUser,
            error: authError,
        } =
            await supabaseAdmin.auth.admin.getUserById(
                fmsUser.id
            );

        const email =
            authUser?.user?.email;

        if (
            authError ||
            !email
        ) {
            return NextResponse.json(
                {
                    message:
                        "Employee account could not be verified.",
                },
                { status: 401 }
            );
        }

        // ---------------------------------------------------------
        // 4. Create the real Supabase client session
        // ---------------------------------------------------------
        const cookieStore = await cookies();

        const cookiesToApply: {
            name: string;
            value: string;
            options: any;
        }[] = [];

        const supabase = createServerClient(
            process.env
                .NEXT_PUBLIC_FMS_SUPABASE_URL!,
            process.env
                .NEXT_PUBLIC_FMS_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll();
                    },

                    setAll(
                        cookiesToSet
                    ) {
                        cookiesToSet.forEach(
                            ({
                                name,
                                value,
                                options,
                            }) => {
                                try {
                                    cookieStore.set(
                                        name,
                                        value,
                                        options
                                    );
                                } catch {
                                    // Final response will receive the cookies.
                                }

                                cookiesToApply.push({
                                    name,
                                    value,
                                    options,
                                });
                            }
                        );
                    },
                },
            }
        );

        const {
            data: signInData,
            error: signInError,
        } =
            await supabase.auth.signInWithPassword(
                {
                    email,
                    password,
                }
            );

        if (
            signInError ||
            !signInData.session ||
            !signInData.user
        ) {
            return NextResponse.json(
                {
                    message:
                        "Employee ID or password is incorrect.",
                },
                { status: 401 }
            );
        }

        if (
            signInData.user.id !==
            fmsUser.id
        ) {
            return NextResponse.json(
                {
                    message:
                        "Unable to verify the FMS account.",
                },
                { status: 403 }
            );
        }

        // ---------------------------------------------------------
        // 5. Consume the temporary login verification token
        // ---------------------------------------------------------
        await supabaseAdmin
            .from("fms_otp_session")
            .delete()
            .eq(
                "token",
                loginVerificationToken
            );

        // ---------------------------------------------------------
        // 6. Return the real Supabase session
        // ---------------------------------------------------------
        const response =
            NextResponse.json({
                success: true,
                session:
                    signInData.session,
                user: {
                    id: fmsUser.id,
                    employeeId:
                        fmsUser.employee_id,
                    role: fmsUser.role,
                },
                redirectTo:
                    "/dashboard",
            });

        cookiesToApply.forEach(
            ({
                name,
                value,
                options,
            }) => {
                response.cookies.set(
                    name,
                    value,
                    options
                );
            }
        );

        return response;
    } catch (error: unknown) {
        console.error(
            "POST /api/auth/fms-login/complete error:",
            error
        );

        return NextResponse.json(
            {
                message:
                    error instanceof Error
                        ? error.message
                        : "An unexpected error occurred while completing login.",
            },
            { status: 500 }
        );
    }
}