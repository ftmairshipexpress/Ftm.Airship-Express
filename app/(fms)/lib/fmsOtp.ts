import "server-only";
import crypto from "crypto";
import { supabaseAdmin } from "@/app/(fms)/lib/supabaseAdmin";

const OTP_TTL_MINUTES = 5;
const LOGIN_OTP_TTL_MINUTES = 2;
const MAX_ATTEMPTS = 3;
const LOCK_MINUTES = 5;
const CODE_LENGTH = 6;
const SESSION_MINUTES = 5;

export type FmsOtpPurpose =
    | "login"
    | "security_settings"
    | "change_password"
    | "change_email";

export type FmsOtpScope =
    | "login"
    | "security_settings"
    | "change_password"
    | "change_email";

function getOtpSecret(): string {
    const secret = process.env.FMS_OTP_SECRET;

    if (!secret) {
        throw new Error("OTP_SECRET is not configured.");
    }

    return secret;
}

function hashCode(code: string): string {
    return crypto
        .createHmac("sha256", getOtpSecret())
        .update(code)
        .digest("hex");
}

function generateCode(): string {
    const min = 10 ** (CODE_LENGTH - 1);
    const max = 10 ** CODE_LENGTH - 1;

    return String(crypto.randomInt(min, max + 1));
}

export async function getActiveLock(userId: string): Promise<{
    locked: boolean;
    unlockAt: Date | null;
    minutesLeft: number;
}> {
    const { data, error } = await supabaseAdmin
        .from("fms_otp_lock")
        .select("locked_until")
        .eq("user_id", userId)
        .maybeSingle();

    if (error || !data) {
        return {
            locked: false,
            unlockAt: null,
            minutesLeft: 0,
        };
    }

    const unlockAt = new Date(data.locked_until);
    const diff = unlockAt.getTime() - Date.now();

    if (diff <= 0) {
        await supabaseAdmin
            .from("fms_otp_lock")
            .delete()
            .eq("user_id", userId);

        return {
            locked: false,
            unlockAt: null,
            minutesLeft: 0,
        };
    }

    return {
        locked: true,
        unlockAt,
        minutesLeft: Math.ceil(diff / 60000),
    };
}

export async function lockUser(
    userId: string,
    purpose: FmsOtpPurpose
): Promise<Date> {
    const lockedUntil = new Date(
        Date.now() + LOCK_MINUTES * 60 * 1000
    );

    const { error } = await supabaseAdmin
        .from("fms_otp_lock")
        .upsert(
            {
                user_id: userId,
                purpose,
                locked_until: lockedUntil.toISOString(),
                locked_at: new Date().toISOString(),
            },
            {
                onConflict: "user_id",
            }
        );

    if (error) {
        throw new Error(error.message);
    }

    return lockedUntil;
}

export async function createOtp({
    userId,
    email,
    purpose,
    ttlMinutes,
}: {
    userId: string;
    email: string;
    purpose: FmsOtpPurpose;
    ttlMinutes?: number;
}): Promise<{
    otpId: string;
    code: string;
    expiresAt: Date;
}> {
    // Invalidate previous unused OTPs for the same user/purpose.
    const { error: invalidateError } = await supabaseAdmin
        .from("fms_otp")
        .update({
            consumed_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("purpose", purpose)
        .is("consumed_at", null);

    if (invalidateError) {
        throw new Error(invalidateError.message);
    }

    const code = generateCode();
    const codeHash = hashCode(code);

    const effectiveTtl =
        ttlMinutes ??
        (purpose === "login"
            ? LOGIN_OTP_TTL_MINUTES
            : OTP_TTL_MINUTES);

    const expiresAt = new Date(
        Date.now() + effectiveTtl * 60 * 1000
    );

    const { data, error } = await supabaseAdmin
        .from("fms_otp")
        .insert({
            user_id: userId,
            email,
            purpose,
            code_hash: codeHash,
            attempts: 0,
            expires_at: expiresAt.toISOString(),
        })
        .select("id")
        .single();

    if (error || !data) {
        throw new Error(
            error?.message || "Failed to create OTP"
        );
    }

    return {
        otpId: data.id,
        code,
        expiresAt,
    };
}

export async function verifyOtp({
    userId,
    otpId,
    purpose,
    code,
}: {
    userId: string;
    otpId: string;
    purpose: FmsOtpPurpose;
    code: string;
}): Promise<{
    ok: boolean;
    reason?:
        | "locked"
        | "no_active_code"
        | "expired"
        | "too_many_attempts"
        | "invalid_code"
        | "database_error";
    minutesLeft?: number;
}> {
    const lock = await getActiveLock(userId);

    if (lock.locked) {
        return {
            ok: false,
            reason: "locked",
            minutesLeft: lock.minutesLeft,
        };
    }

    const { data: otp, error } = await supabaseAdmin
        .from("fms_otp")
        .select(
            "id, code_hash, attempts, expires_at"
        )
        .eq("id", otpId)
        .eq("user_id", userId)
        .eq("purpose", purpose)
        .is("consumed_at", null)
        .maybeSingle();

    if (error) {
        return {
            ok: false,
            reason: "database_error",
        };
    }

    if (!otp) {
        return {
            ok: false,
            reason: "no_active_code",
        };
    }

    if (
        new Date(otp.expires_at).getTime() <=
        Date.now()
    ) {
        await supabaseAdmin
            .from("fms_otp")
            .update({
                consumed_at: new Date().toISOString(),
            })
            .eq("id", otp.id);

        return {
            ok: false,
            reason: "expired",
        };
    }

    if (otp.attempts >= MAX_ATTEMPTS) {
        return {
            ok: false,
            reason: "too_many_attempts",
        };
    }

    const providedHash = hashCode(code);
    const expectedHash = String(otp.code_hash);

    const hashesMatch =
        providedHash.length === expectedHash.length &&
        crypto.timingSafeEqual(
            Buffer.from(providedHash, "utf8"),
            Buffer.from(expectedHash, "utf8")
        );

    if (!hashesMatch) {
        const nextAttempts = otp.attempts + 1;

        const { error: updateError } = await supabaseAdmin
            .from("fms_otp")
            .update({
                attempts: nextAttempts,
            })
            .eq("id", otp.id);

        if (updateError) {
            return {
                ok: false,
                reason: "database_error",
            };
        }

        if (nextAttempts >= MAX_ATTEMPTS) {
            await lockUser(userId, purpose);

            return {
                ok: false,
                reason: "too_many_attempts",
                minutesLeft: LOCK_MINUTES,
            };
        }

        return {
            ok: false,
            reason: "invalid_code",
        };
    }

    // Consume OTP immediately after successful verification.
    const { error: consumeError } = await supabaseAdmin
        .from("fms_otp")
        .update({
            consumed_at: new Date().toISOString(),
        })
        .eq("id", otp.id);

    if (consumeError) {
        return {
            ok: false,
            reason: "database_error",
        };
    }

    // Remove any existing lock after a successful verification.
    await supabaseAdmin
        .from("fms_otp_lock")
        .delete()
        .eq("user_id", userId);

    return {
        ok: true,
    };
}

export async function createSession(
    userId: string,
    scope: FmsOtpScope
): Promise<{
    token: string;
    expiresAt: Date;
}> {
    const expiresAt = new Date(
        Date.now() + SESSION_MINUTES * 60 * 1000
    );

    // One active verification session per user.
    await supabaseAdmin
        .from("fms_otp_session")
        .delete()
        .eq("user_id", userId);

    const { data, error } = await supabaseAdmin
        .from("fms_otp_session")
        .insert({
            user_id: userId,
            scope,
            expires_at: expiresAt.toISOString(),
        })
        .select("token")
        .single();

    if (error || !data) {
        throw new Error(
            error?.message ||
                "Failed to create OTP session"
        );
    }

    return {
        token: data.token,
        expiresAt,
    };
}

export async function getActiveSession(
    userId: string
): Promise<{
    active: boolean;
    token: string | null;
    scope: FmsOtpScope | null;
    expiresAt: Date | null;
    secondsLeft: number;
}> {
    const { data, error } = await supabaseAdmin
        .from("fms_otp_session")
        .select(
            "token, scope, expires_at"
        )
        .eq("user_id", userId)
        .order("created_at", {
            ascending: false,
        })
        .limit(1)
        .maybeSingle();

    if (error || !data) {
        return {
            active: false,
            token: null,
            scope: null,
            expiresAt: null,
            secondsLeft: 0,
        };
    }

    const expiresAt = new Date(data.expires_at);
    const diff =
        expiresAt.getTime() - Date.now();

    if (diff <= 0) {
        await supabaseAdmin
            .from("fms_otp_session")
            .delete()
            .eq("user_id", userId);

        return {
            active: false,
            token: null,
            scope: null,
            expiresAt: null,
            secondsLeft: 0,
        };
    }

    return {
        active: true,
        token: data.token,
        scope: data.scope as FmsOtpScope,
        expiresAt,
        secondsLeft: Math.ceil(diff / 1000),
    };
}

export async function clearSession(
    userId: string
): Promise<void> {
    const { error } = await supabaseAdmin
        .from("fms_otp_session")
        .delete()
        .eq("user_id", userId);

    if (error) {
        throw new Error(error.message);
    }
}

export async function validateSession(
    userId: string,
    token: string,
    scope?: FmsOtpScope
): Promise<boolean> {
    const { data, error } = await supabaseAdmin
        .from("fms_otp_session")
        .select("expires_at, scope")
        .eq("user_id", userId)
        .eq("token", token)
        .maybeSingle();

    if (error || !data) {
        return false;
    }

    const notExpired =
        new Date(data.expires_at).getTime() >
        Date.now();

    if (!notExpired) {
        return false;
    }

    if (scope && data.scope !== scope) {
        return false;
    }

    return true;
}

export const OTP_TTL = OTP_TTL_MINUTES;
export const LOGIN_OTP_TTL = LOGIN_OTP_TTL_MINUTES;
export const OTP_MAX_ATTEMPTS = MAX_ATTEMPTS;
export const OTP_LOCK = LOCK_MINUTES;
export const OTP_SESSION = SESSION_MINUTES;