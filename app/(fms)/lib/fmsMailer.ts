import "server-only";
import nodemailer from "nodemailer";

const user = process.env.GMAIL_FMS_USER;
const pass = process.env.GMAIL_FMS_APP_PASSWORD;

if (!user || !pass) {
    throw new Error(
        "GMAIL_FMS_USER or GMAIL_FMS_APP_PASSWORD is not configured."
    );
}

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user,
        pass,
    },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
});

function esc(input: string | null | undefined): string {
    if (input === null || input === undefined) {
        return "";
    }

    return String(input)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export async function sendFmsOtpEmail({
    to,
    code,
    ttlMinutes = 2,
}: {
    to: string;
    code: string;
    ttlMinutes?: number;
}) {
    const subject =
        "Airship Express FMS sign-in verification";

    const text = [
        "Airship Express Financial Management System",
        "",
        "Your sign-in verification code is:",
        "",
        code,
        "",
        `This code expires in ${ttlMinutes} minutes.`,
        "Do not share this code with anyone.",
        "",
        "Airship Express",
        "Binondo, Manila, Philippines",
        "",
        "This is an automated message. Do not reply.",
    ].join("\n");

    const html = `
        <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c1b1f;background:#ffffff">
            <div style="border-bottom:2px solid #e5167e;padding-bottom:12px;margin-bottom:20px">
                <h1 style="margin:0;font-size:20px;color:#1c1b1f">
                    Airship Express
                </h1>
                <p style="margin:4px 0 0;font-size:12px;color:#6b6b76">
                    Financial Management System
                </p>
            </div>

            <p style="margin:0 0 16px;font-size:14px">
                Your FMS sign-in verification code is:
            </p>

            <p style="margin:0 0 16px;font-family:Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:5px">
                ${esc(code)}
            </p>

            <p style="margin:0 0 16px;font-size:13px;color:#555">
                This code expires in
                <strong>${ttlMinutes} minutes</strong>.
            </p>

            <div style="margin:16px 0;padding:12px;background:#fff7ed;border-left:3px solid #f59e0b;font-size:12px;color:#7c4a03;border-radius:4px">
                <strong>Security notice:</strong>
                Never share this verification code with anyone.
            </div>

            <p style="margin:24px 0 0;color:#8a8a93;font-size:11px;border-top:1px solid #eee;padding-top:16px">
                Airship Express · Binondo, Manila, Philippines<br>
                This is an automated message. Do not reply.
            </p>
        </div>
    `;

    await transporter.sendMail({
        from: `"Airship Express FMS" <${user}>`,
        to,
        replyTo: user,
        subject,
        text,
        html,
    });
}