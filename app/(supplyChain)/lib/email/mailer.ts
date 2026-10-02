import nodemailer from 'nodemailer';

export interface EmailRecipient {
    email: string;
    name?: string;
}

export interface EmailAttachment {
    name: string;
    content: string; // base64 encoded string
    contentType?: string;
}

export interface SendSupplyChainEmailOptions {
    to: string | string[] | EmailRecipient | EmailRecipient[];
    subject: string;
    html: string;
    text?: string;
    senderName?: string;
    senderEmail?: string;
    replyTo?: string;
    cc?: string | string[] | EmailRecipient[];
    bcc?: string | string[] | EmailRecipient[];
    attachments?: EmailAttachment[];
}

export interface SendEmailResult {
    success: boolean;
    messageId?: string;
    provider?: 'brevo' | 'smtp';
    error?: string;
}

/**
 * Normalizes email recipient inputs into an array of { email, name } objects
 */
function normalizeRecipients(input?: string | string[] | EmailRecipient | EmailRecipient[]): EmailRecipient[] {
    if (!input) return [];

    if (typeof input === 'string') {
        return input
            .split(',')
            .map(e => e.trim())
            .filter(Boolean)
            .map(email => ({ email }));
    }

    if (Array.isArray(input)) {
        const recipients: EmailRecipient[] = [];
        for (const item of input) {
            if (typeof item === 'string') {
                const trimmed = item.trim();
                if (trimmed) recipients.push({ email: trimmed });
            } else if (item && typeof item === 'object' && item.email) {
                recipients.push({ email: item.email.trim(), name: item.name });
            }
        }
        return recipients;
    }

    if (typeof input === 'object' && input.email) {
        return [{ email: input.email.trim(), name: input.name }];
    }

    return [];
}

/**
 * Sends transactional email using Brevo REST API, with fallback to Gmail SMTP (nodemailer)
 */
export async function sendSupplyChainEmail(
    options: SendSupplyChainEmailOptions
): Promise<SendEmailResult> {
    const {
        to,
        subject,
        html,
        text,
        senderName = 'Airship Express Supply Chain',
        senderEmail,
        replyTo,
        cc,
        bcc,
        attachments = []
    } = options;

    const toRecipients = normalizeRecipients(to);
    const ccRecipients = normalizeRecipients(cc);
    const bccRecipients = normalizeRecipients(bcc);

    if (toRecipients.length === 0) {
        throw new Error('No valid recipient email address provided');
    }

    const brevoApiKey = (
        process.env.BREVO_SUPPLYCHAIN_API_KEY || 
        process.env.BREVO_API_KEY || 
        process.env.BREVO_KEY
    )?.trim();

    // Verified Brevo sender registered under Brevo account
    const brevoSenderEmail = process.env.BREVO_SUPPLYCHAIN_SENDER || process.env.BREVO_SENDER || 'supplychain.airshipexpress@gmail.com';
    const fallbackEmail = process.env.EMAIL_SUPPLYCHAIN_USER || process.env.EMAIL_USER || process.env.EMAIL_FROM || 'supplychain.airshipexpress@gmail.com';
    const activeReplyTo = replyTo || senderEmail || fallbackEmail;

    // 1. Primary Method: Nodemailer Gmail SMTP (Direct Google-signed delivery into Primary Inbox)
    const smtpUser = process.env.EMAIL_SUPPLYCHAIN_USER || process.env.EMAIL_USER || process.env.EMAIL_FROM || process.env.SMTP_USER;
    const smtpPass = process.env.EMAIL_SUPPLYCHAIN_PASS || process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD || process.env.SMTP_PASS;

    if (smtpUser && smtpPass) {
        try {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: smtpUser,
                    pass: smtpPass,
                },
                pool: true,
                maxConnections: 5,
                connectionTimeout: 8000,
            });

            const mailOptions: any = {
                from: `"${senderName}" <${smtpUser}>`,
                to: toRecipients.map(r => r.name ? `"${r.name}" <${r.email}>` : r.email).join(', '),
                subject: subject,
                html: html,
                text: text || '',
                replyTo: activeReplyTo,
            };

            if (ccRecipients.length > 0) {
                mailOptions.cc = ccRecipients.map(r => r.name ? `"${r.name}" <${r.email}>` : r.email).join(', ');
            }

            if (bccRecipients.length > 0) {
                mailOptions.bcc = bccRecipients.map(r => r.name ? `"${r.name}" <${r.email}>` : r.email).join(', ');
            }

            if (attachments.length > 0) {
                mailOptions.attachments = attachments.map(att => ({
                    filename: att.name,
                    content: Buffer.from(att.content, 'base64'),
                    contentType: att.contentType,
                }));
            }

            const info = await transporter.sendMail(mailOptions);

            return {
                success: true,
                messageId: info.messageId,
                provider: 'smtp',
            };
        } catch (smtpErr: any) {
            console.error('SMTP send error, falling back to Brevo if available:', smtpErr);
        }
    }

    // 2. Secondary / Fallback Method: Brevo REST API
    if (brevoApiKey) {
        try {
            const brevoPayload: any = {
                sender: {
                    name: senderName,
                    email: brevoSenderEmail,
                },
                to: toRecipients.map(r => ({ email: r.email, ...(r.name ? { name: r.name } : {}) })),
                subject: subject,
                htmlContent: html,
            };

            if (text) {
                brevoPayload.textContent = text;
            }

            if (activeReplyTo) {
                brevoPayload.replyTo = {
                    email: activeReplyTo,
                    name: senderName,
                };
            }

            if (ccRecipients.length > 0) {
                brevoPayload.cc = ccRecipients.map(r => ({ email: r.email, ...(r.name ? { name: r.name } : {}) }));
            }

            if (bccRecipients.length > 0) {
                brevoPayload.bcc = bccRecipients.map(r => ({ email: r.email, ...(r.name ? { name: r.name } : {}) }));
            }

            if (attachments.length > 0) {
                brevoPayload.attachment = attachments.map(att => ({
                    name: att.name,
                    content: att.content,
                }));
            }

            const response = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'api-key': brevoApiKey,
                    'content-type': 'application/json',
                },
                body: JSON.stringify(brevoPayload),
            });

            const data = await response.json().catch(() => ({}));

            if (response.ok) {
                return {
                    success: true,
                    messageId: data.messageId || 'brevo-sent',
                    provider: 'brevo',
                };
            }

            console.warn('Brevo API responded with error:', data);
        } catch (brevoErr: any) {
            console.error('Brevo API request error:', brevoErr);
        }
    }

    throw new Error('No email provider is configured. Please check your Brevo or SMTP credentials in .env');
}
