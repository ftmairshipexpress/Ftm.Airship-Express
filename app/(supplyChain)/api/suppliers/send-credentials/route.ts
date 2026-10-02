import { NextResponse } from "next/server";
import { sendSupplyChainEmail } from "../../../lib/email/mailer";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            supplierName,
            contactName,
            email,
            invitedBy,
        } = body;

        if (!email) {
            return NextResponse.json(
                { message: "Email is required" },
                { status: 400 }
            );
        }

        const normalizedEmail = email.trim().toLowerCase();
        const recipientName = contactName?.trim() || supplierName || "Partner";
        const companyName = supplierName || "Supplier Company";
        const roleBasedPassword = "SupplyChain_Supplier";

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
            <title>Supplier Portal Account Credentials</title>
        </head>
        <body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #1e293b;">
            <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #fff; opacity: 0;">
                Your Airship Express Supplier Portal account sign-in instructions.
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
                    <h2 style="color: #9d174d; font-size: 16px; font-weight: 700; margin: 0 0 6px 0;">Sign-In Instructions Resent</h2>
                    <p style="color: #475569; font-size: 14px; line-height: 1.5; margin: 0;">
                        Hello <strong>${recipientName}</strong>, here are your login instructions for the Airship Express Supplier Portal for <strong>${companyName}</strong>.
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
                        <strong style="font-size: 13px; color: #9d174d; text-transform: uppercase; letter-spacing: 0.5px;">Your Supplier Account Selection</strong>
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
                            <td style="padding: 6px 0; color: #701a75; font-size: 13px;">Verification:</td>
                            <td style="padding: 6px 0; color: #475569; font-size: 13px;">Verify with OTP sent to your email and log in</td>
                        </tr>
                    </table>
                </div>

                <div style="margin-bottom: 24px;">
                    <h3 style="font-size: 14px; font-weight: 700; color: #334155; margin-bottom: 8px;">How to Access the Portal:</h3>
                    <ol style="color: #475569; font-size: 13px; line-height: 1.7; margin: 0; padding-left: 20px;">
                        <li>Visit the Login Portal at <a href="${loginUrl}" style="color: #db2777; font-weight: 600; text-decoration: none;">${loginUrl}</a>.</li>
                        <li>Enter the Role Account email <code>supplier@gmail.com</code> and password <code>${roleBasedPassword}</code>.</li>
                        <li>From the Active Suppliers directory, click on <strong>${companyName}</strong> (${recipientName}).</li>
                        <li>Complete the OTP verification and access your purchase orders.</li>
                    </ol>
                </div>

                <div style="text-align: center; margin: 32px 0;">
                    <a href="${loginUrl}" style="background-color: #db2777; color: #ffffff; padding: 13px 32px; border-radius: 9999px; text-decoration: none; font-weight: 700; font-size: 14px; display: inline-block; box-shadow: 0 4px 14px rgba(219, 39, 119, 0.35);">Log In to Supplier Portal</a>
                </div>

                <div style="border-top: 1px solid #e2e8f0; padding-top: 18px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                    <p style="margin: 0 0 4px 0;">Airship Express Inc. • Procurement & Supplier Network</p>
                    <p style="margin: 0;">Authorized by ${invitedBy || "Procurement Executive"}</p>
                </div>
            </div>
        </body>
        </html>
        `;

        const plainText = `Airship Express Supplier Portal Instructions\n\nHello ${recipientName},\nHere are your Supplier Portal sign-in instructions for ${companyName}.\n\nSTEP 1 - Role Account Login:\nEmail: supplier@gmail.com\nPassword: ${roleBasedPassword}\n\nSTEP 2 - Select Your Account:\nSupplier: ${companyName}\nEmail: ${normalizedEmail}\n\nAccess the portal at: ${loginUrl}\n\nAuthorized by: ${invitedBy || "Procurement Executive"}`;

        const emailResult = await sendSupplyChainEmail({
            to: normalizedEmail,
            subject: `[Airship Express] Supplier Portal Account Access: ${companyName}`,
            html: emailHtml,
            text: plainText,
            senderName: "Airship Express Supply Chain",
        });

        return NextResponse.json({
            ok: true,
            emailSent: emailResult.success,
            message: "Sign-in instructions email sent successfully to " + normalizedEmail,
        });
    } catch (err: any) {
        console.error("Error sending supplier credentials email:", err);
        return NextResponse.json(
            { message: "Failed to send email: " + err.message },
            { status: 500 }
        );
    }
}
