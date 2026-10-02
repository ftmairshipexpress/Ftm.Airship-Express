import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { sendSupplyChainEmail } from "../../../lib/email/mailer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPPLYCHAIN_SUPABASE_URL || "https://sswjqqpfaumxojbkkpbl.supabase.co";
const serviceRoleKey = process.env.NEXT_PUBLIC_SUPPLYCHAIN_SUPABASE_SERVICE_ROLE_KEY || 
                       process.env.SUPPLYCHAIN_SUPABASE_SERVICE_ROLE_KEY || 
                       process.env.NEXT_PUBLIC_SUPPLYCHAIN_SUPABASE_ANON_KEY || "";

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            supplierId,
            supplierName,
            contactName,
            email,
            invitedBy,
            invitedByName
        } = body;

        if (!supplierId || !email || !contactName) {
            return NextResponse.json(
                { ok: false, message: "Missing required supplier fields (supplierId, email, contactName)" },
                { status: 400 }
            );
        }

        const normalizedEmail = email.trim().toLowerCase();
        const trimmedContactName = contactName.trim();
        const companyName = supplierName || "Supplier Company";
        const roleBasedPassword = "SupplyChain_Supplier";

        // 1. Insert or update record ONLY in public.suppliers_account table
        const accountId = randomUUID();

        const supplierAccPayload: any = {
            id: accountId,
            supplier_id: supplierId,
            email: normalizedEmail,
            contact_name: trimmedContactName,
            status: "Active",
            invited_by: invitedBy || null,
            invited_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        const { data: insertedAcc, error: accErr } = await supabaseAdmin
            .from("suppliers_account")
            .upsert(supplierAccPayload, { onConflict: "email" })
            .select()
            .single();

        if (accErr) {
            console.error("Error upserting into suppliers_account:", accErr);
            // Fallback direct update by email
            const { data: updatedAcc, error: updateAccErr } = await supabaseAdmin
                .from("suppliers_account")
                .update({
                    supplier_id: supplierId,
                    contact_name: trimmedContactName,
                    status: "Active",
                    invited_by: invitedBy || null,
                    updated_at: new Date().toISOString(),
                })
                .eq("email", normalizedEmail)
                .select()
                .single();

            if (updateAccErr) {
                return NextResponse.json(
                    { ok: false, message: "Failed to store in suppliers_account: " + (accErr.message || updateAccErr.message) },
                    { status: 500 }
                );
            }
        }

        // 2. Notify Admin & Executive & Record in user_activity
        try {
            await supabaseAdmin.from("notifications").insert([
                {
                    creator_name: invitedByName || "Administrator",
                    creator_email: "procurement@airshipexpress.ph",
                    title: "New Supplier Account Registered",
                    message: `A supplier portal account for ${companyName} (${normalizedEmail}) was registered by ${invitedByName || "Administrator"}.`,
                    role: ["Admin", "Executive"],
                    type: "supplier_account",
                    link: "/suppliers",
                    is_read: false,
                    created_at: new Date().toISOString(),
                },
            ]);

            // Log to user_activity table
            if (invitedBy) {
                const userAgent = request.headers.get('user-agent') || 'Server';
                const ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1';
                await supabaseAdmin.from('user_activity').insert({
                    user_id: invitedBy,
                    action: 'SUPPLIER_ACCOUNT_CREATED',
                    module: 'Suppliers',
                    description: `${invitedByName || 'Executive'} registered a new supplier account for ${companyName} (${normalizedEmail}).`,
                    ip_address: ipAddress,
                    user_agent: userAgent,
                    created_at: new Date().toISOString(),
                });
            }
        } catch (notifErr) {
            console.warn("Notification/UserActivity insert notice:", notifErr);
        }

        // 3. Send Invitation Email with Role credentials & instructions
        let emailSent = false;
        let emailError: string | null = null;

        try {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 
                           process.env.NEXT_PUBLIC_SUPPLYCHAIN_APP_URL || 
                           "http://sc.localhost:3000";
            const loginUrl = `${appUrl}/scAuth`;

            const emailHtml = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Supplier Portal Account Access</title>
            </head>
            <body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #1e293b;">
                <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #fff; opacity: 0;">
                    Your Airship Express Supplier Portal account has been created. Here are your sign-in instructions.
                </div>

                <div style="max-width: 620px; margin: 0 auto; padding: 32px 24px; background-color: #ffffff; color: #1e293b; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <span style="display: inline-block; background-color: #db2777; color: #ffffff; font-size: 11px; font-weight: 800; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
                            Airship Express Supply Chain
                        </span>
                        <h1 style="color: #0f172a; font-size: 24px; font-weight: 800; margin: 4px 0 0;">Supplier Portal Access</h1>
                        <p style="color: #64748b; font-size: 13px; margin-top: 4px; font-weight: 500;">Authorized Procurement & Partner Network</p>
                    </div>

                    <div style="background-color: #fdf2f8; border: 1px solid #fbcfe8; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
                        <h2 style="color: #9d174d; font-size: 16px; font-weight: 700; margin: 0 0 6px 0;">Official Account Established</h2>
                        <p style="color: #475569; font-size: 14px; line-height: 1.5; margin: 0;">
                            Hello <strong>${trimmedContactName}</strong>, your Supplier Portal account has been registered for <strong>${companyName}</strong>. You can now access your purchase orders, dispatch tracking, and direct supplier messaging.
                        </p>
                    </div>

                    <!-- Step 1: Role Account -->
                    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-bottom: 16px;">
                        <div style="display: flex; align-items: center; margin-bottom: 10px;">
                            <span style="background-color: #0284c7; color: #ffffff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; margin-right: 8px;">STEP 1</span>
                            <strong style="font-size: 13px; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">Role-Based Account Login</strong>
                        </div>
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr>
                                <td style="padding: 6px 0; color: #64748b; width: 160px; font-size: 13px;">Role Account Email:</td>
                                <td style="padding: 6px 0; font-weight: 700; color: #0f172a; font-family: monospace;">supplier@gmail.com</td>
                            </tr>
                            <tr>
                                <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Role Account Password:</td>
                                <td style="padding: 6px 0;">
                                    <span style="font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 14px; font-weight: 700; color: #0284c7; background-color: #e0f2fe; padding: 3px 8px; border-radius: 4px; display: inline-block;">${roleBasedPassword}</span>
                                </td>
                            </tr>
                        </table>
                    </div>

                    <!-- Step 2: Supplier Specific Account -->
                    <div style="background-color: #fdf4ff; border: 1px solid #f5d0fe; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
                        <div style="display: flex; align-items: center; margin-bottom: 10px;">
                            <span style="background-color: #db2777; color: #ffffff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; margin-right: 8px;">STEP 2</span>
                            <strong style="font-size: 13px; color: #9d174d; text-transform: uppercase; letter-spacing: 0.5px;">Your Supplier Selection & Setup</strong>
                        </div>
                        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                            <tr>
                                <td style="padding: 6px 0; color: #701a75; width: 160px; font-size: 13px;">Company Name:</td>
                                <td style="padding: 6px 0; font-weight: 700; color: #0f172a;">${companyName}</td>
                            </tr>
                            <tr>
                                <td style="padding: 6px 0; color: #701a75; font-size: 13px;">Your Supplier Email:</td>
                                <td style="padding: 6px 0; font-weight: 700; color: #db2777;">${normalizedEmail}</td>
                            </tr>
                            <tr>
                                <td style="padding: 6px 0; color: #701a75; font-size: 13px;">First-Time Setup:</td>
                                <td style="padding: 6px 0; color: #475569; font-size: 13px;">Verify with OTP and create your password</td>
                            </tr>
                        </table>
                    </div>

                    <div style="margin-bottom: 24px;">
                        <h3 style="font-size: 14px; font-weight: 700; color: #334155; margin-bottom: 8px;">How to Access the Portal:</h3>
                        <ol style="color: #475569; font-size: 13px; line-height: 1.7; margin: 0; padding-left: 20px;">
                            <li>Visit the Login Portal at <a href="${loginUrl}" style="color: #db2777; font-weight: 600; text-decoration: none;">${loginUrl}</a>.</li>
                            <li>Enter the Role Account email <code>supplier@gmail.com</code> and password <code>${roleBasedPassword}</code>.</li>
                            <li>From the Active Suppliers directory, select <strong>${companyName}</strong> (${trimmedContactName}).</li>
                            <li>Complete the OTP verification sent to this email, create your secure password, and access your purchase orders.</li>
                        </ol>
                    </div>

                    <div style="text-align: center; margin: 32px 0;">
                        <a href="${loginUrl}" style="background-color: #db2777; color: #ffffff; padding: 13px 32px; border-radius: 9999px; text-decoration: none; font-weight: 700; font-size: 14px; display: inline-block; box-shadow: 0 4px 14px rgba(219, 39, 119, 0.35);">Access Supplier Portal</a>
                    </div>

                    <div style="border-top: 1px solid #e2e8f0; padding-top: 18px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                        <p style="margin: 0 0 4px 0;">Airship Express Inc. • Procurement & Supplier Network</p>
                        <p style="margin: 0;">Provisioned by ${invitedByName || "Procurement Executive"}</p>
                    </div>
                </div>
            </body>
            </html>
            `;

            const plainText = `Airship Express Supplier Portal Account Created\n\nHello ${trimmedContactName},\nYour Supplier Portal account for ${companyName} has been created.\n\nSTEP 1 - Role Account Login:\nEmail: supplier@gmail.com\nPassword: ${roleBasedPassword}\n\nSTEP 2 - Select Your Account:\nSupplier: ${companyName}\nEmail: ${normalizedEmail}\n\nAccess the portal at: ${loginUrl}\n\nAuthorized by: ${invitedByName || "Procurement Executive"}`;

            const emailResult = await sendSupplyChainEmail({
                to: normalizedEmail,
                subject: `[Airship Express] Supplier Portal Account Access: ${companyName}`,
                html: emailHtml,
                text: plainText,
                senderName: "Airship Express Supply Chain",
            });

            emailSent = emailResult.success;
        } catch (mailErr: any) {
            console.error("Supplier account email error:", mailErr);
            emailError = mailErr.message || "Failed to deliver email";
        }

        return NextResponse.json({
            ok: true,
            data: insertedAcc || supplierAccPayload,
            emailSent,
            emailError,
            message: emailSent 
                ? "Supplier registered in Directory and invitation emailed to " + normalizedEmail
                : "Supplier registered (Email status: " + (emailError || "Check mailer configuration") + ")"
        });
    } catch (error: any) {
        console.error("Supplier creation API error:", error);
        return NextResponse.json(
            { ok: false, message: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}
