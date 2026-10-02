"use client";

import {
    useEffect,
    useRef,
    useState,
} from "react";
import {
    Loader2,
    Lock,
    Mail,
    RefreshCw,
    ShieldCheck,
} from "lucide-react";

interface FmsLoginOtpModalProps {
    isOpen: boolean;
    otpId: string;
    email: string;
    expiresAt: string;
    onClose: () => void;
    onVerified: (session: {
        token: string;
        scope: string;
        secondsLeft: number;
    }) => Promise<void> | void;
}

const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 3;
const RESEND_COOLDOWN = 30;

export default function FmsLoginOtpModal({
    isOpen,
    otpId,
    email,
    expiresAt,
    onClose,
    onVerified,
}: FmsLoginOtpModalProps) {
    const [digits, setDigits] =
        useState<string[]>(
            Array(CODE_LENGTH).fill("")
        );

    const [currentOtpId, setCurrentOtpId] =
        useState(otpId);

    const [currentExpiresAt, setCurrentExpiresAt] =
        useState(expiresAt);

    const [secondsLeft, setSecondsLeft] =
        useState(0);

    const [cooldown, setCooldown] =
        useState(0);

    const [attemptsLeft, setAttemptsLeft] =
        useState(MAX_ATTEMPTS);

    const [lockedSeconds, setLockedSeconds] =
        useState(0);

    const [error, setError] =
        useState("");

    const [isVerifying, setIsVerifying] =
        useState(false);

    const [isSending, setIsSending] =
        useState(false);

    const inputRefs =
        useRef<Array<HTMLInputElement | null>>(
            []
        );

    useEffect(() => {
        if (!isOpen) return;

        setCurrentOtpId(otpId);
        setCurrentExpiresAt(expiresAt);
        setDigits(
            Array(CODE_LENGTH).fill("")
        );
        setAttemptsLeft(MAX_ATTEMPTS);
        setCooldown(0);
        setLockedSeconds(0);
        setError("");

        setTimeout(() => {
            inputRefs.current[0]?.focus();
        }, 100);
    }, [isOpen, otpId, expiresAt]);

    useEffect(() => {
        if (!isOpen || !currentExpiresAt)
            return;

        const update = () => {
            const diff = Math.max(
                0,
                Math.floor(
                    (
                        new Date(
                            currentExpiresAt
                        ).getTime() -
                        Date.now()
                    ) / 1000
                )
            );

            setSecondsLeft(diff);
        };

        update();

        const interval =
            setInterval(update, 1000);

        return () =>
            clearInterval(interval);
    }, [
        isOpen,
        currentExpiresAt,
    ]);

    useEffect(() => {
        if (cooldown <= 0) return;

        const interval =
            setInterval(() => {
                setCooldown(
                    (value) =>
                        Math.max(
                            0,
                            value - 1
                        )
                );
            }, 1000);

        return () =>
            clearInterval(interval);
    }, [cooldown]);

    useEffect(() => {
        if (lockedSeconds <= 0)
            return;

        const interval =
            setInterval(() => {
                setLockedSeconds(
                    (value) =>
                        Math.max(
                            0,
                            value - 1
                        )
                );
            }, 1000);

        return () =>
            clearInterval(interval);
    }, [lockedSeconds]);

    const expired =
        secondsLeft <= 0;

    const locked =
        lockedSeconds > 0;

    const code =
        digits.join("");

    const formatTime = (
        total: number
    ) => {
        const minutes = Math.floor(
            total / 60
        );

        const seconds =
            total % 60;

        return `${minutes}:${String(
            seconds
        ).padStart(2, "0")}`;
    };

    const handleChange = (
        index: number,
        value: string
    ) => {
        const clean = value.replace(
            /\D/g,
            ""
        );

        if (!clean) {
            setDigits((current) => {
                const next = [
                    ...current,
                ];
                next[index] = "";
                return next;
            });
            return;
        }

        if (clean.length > 1) {
            const pasted =
                clean.slice(
                    0,
                    CODE_LENGTH
                );

            setDigits((current) => {
                const next = [
                    ...current,
                ];

                pasted
                    .split("")
                    .forEach(
                        (
                            char,
                            offset
                        ) => {
                            if (
                                index +
                                    offset <
                                CODE_LENGTH
                            ) {
                                next[
                                    index +
                                        offset
                                ] =
                                    char;
                            }
                        }
                    );

                return next;
            });

            const nextIndex =
                Math.min(
                    index +
                        pasted.length,
                    CODE_LENGTH - 1
                );

            inputRefs.current[
                nextIndex
            ]?.focus();

            return;
        }

        setDigits((current) => {
            const next = [
                ...current,
            ];
            next[index] = clean;
            return next;
        });

        if (
            index <
            CODE_LENGTH - 1
        ) {
            inputRefs.current[
                index + 1
            ]?.focus();
        }
    };

    const handleKeyDown = (
        index: number,
        event: React.KeyboardEvent<HTMLInputElement>
    ) => {
        if (
            event.key ===
                "Backspace" &&
            !digits[index] &&
            index > 0
        ) {
            inputRefs.current[
                index - 1
            ]?.focus();
        }

        if (
            event.key === "ArrowLeft" &&
            index > 0
        ) {
            inputRefs.current[
                index - 1
            ]?.focus();
        }

        if (
            event.key === "ArrowRight" &&
            index <
                CODE_LENGTH - 1
        ) {
            inputRefs.current[
                index + 1
            ]?.focus();
        }

        if (
            event.key === "Enter"
        ) {
            event.preventDefault();

            void handleVerify();
        }
    };

    const handleVerify =
        async () => {
            if (code.length !== CODE_LENGTH)
                return;

            if (
                isVerifying ||
                locked ||
                expired
            ) {
                return;
            }

            setIsVerifying(true);
            setError("");

            try {
                const response =
                    await fetch(
                        "/api/auth/fms-login/otp/verify",
                        {
                            method: "POST",
                            headers: {
                                "Content-Type":
                                    "application/json",
                            },
                            credentials:
                                "include",
                            body: JSON.stringify(
                                {
                                    otp_id:
                                        currentOtpId,
                                    code,
                                }
                            ),
                        }
                    );

                const data =
                    await response
                        .json()
                        .catch(
                            () => null
                        );

                if (!response.ok) {
                    if (
                        response.status ===
                        429
                    ) {
                        const minutes =
                            Number(
                                data?.minutes_left ??
                                    5
                            );

                        setLockedSeconds(
                            minutes * 60
                        );

                        setAttemptsLeft(0);

                        throw new Error(
                            data?.message ??
                                "Too many incorrect attempts."
                        );
                    }

                    throw new Error(
                        data?.message ??
                            "Incorrect verification code."
                    );
                }

                await onVerified({
                    token:
                        data.session_token,
                    scope:
                        data.scope ??
                        "login",
                    secondsLeft:
                        Number(
                            data.session_minutes ??
                                5
                        ) * 60,
                });

                onClose();
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : "Verification failed.";

                setError(message);

                if (
                    attemptsLeft > 0 &&
                    !locked
                ) {
                    setAttemptsLeft(
                        (value) =>
                            Math.max(
                                0,
                                value - 1
                            )
                    );
                }

                setDigits(
                    Array(CODE_LENGTH).fill(
                        ""
                    )
                );

                setTimeout(() => {
                    inputRefs.current[
                        0
                    ]?.focus();
                }, 50);
            } finally {
                setIsVerifying(false);
            }
        };

    const handleResend =
        async () => {
            if (
                isSending ||
                cooldown > 0 ||
                locked
            ) {
                return;
            }

            setIsSending(true);
            setError("");

            try {
                const response =
                    await fetch(
                        "/api/auth/fms-login/otp/send",
                        {
                            method: "POST",
                            headers: {
                                "Content-Type":
                                    "application/json",
                            },
                            credentials:
                                "include",
                            body: JSON.stringify(
                                {
                                    otp_id:
                                        currentOtpId,
                                }
                            ),
                        }
                    );

                const data =
                    await response
                        .json()
                        .catch(
                            () => null
                        );

                if (!response.ok) {
                    if (
                        response.status ===
                        429
                    ) {
                        const retry =
                            Number(
                                data?.retry_after ??
                                    30
                            );

                        setCooldown(
                            retry
                        );
                    }

                    throw new Error(
                        data?.message ??
                            "Failed to resend the verification code."
                    );
                }

                if (
                    data?.otp_id
                ) {
                    setCurrentOtpId(
                        data.otp_id
                    );
                }

                if (
                    data?.expires_at
                ) {
                    setCurrentExpiresAt(
                        data.expires_at
                    );
                }

                setDigits(
                    Array(CODE_LENGTH).fill(
                        ""
                    )
                );

                setAttemptsLeft(
                    MAX_ATTEMPTS
                );

                setCooldown(
                    Number(
                        data?.cooldown_seconds ??
                            RESEND_COOLDOWN
                    )
                );
            } catch (error) {
                setError(
                    error instanceof Error
                        ? error.message
                        : "Failed to resend the code."
                );
            } finally {
                setIsSending(false);
            }
        };

    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-md rounded-2xl border border-line bg-paper p-6 shadow-2xl">
                <div className="mb-6 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                        <ShieldCheck className="h-5 w-5 text-accent" />
                    </div>

                    <div>
                        <h2 className="text-lg font-semibold text-ink">
                            Verify your sign-in
                        </h2>

                        <p className="text-xs text-muted">
                            A verification code was sent to{" "}
                            <span className="font-medium text-ink">
                                {email}
                            </span>
                        </p>
                    </div>
                </div>

                <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50/60 p-3.5">
                    <div className="flex gap-2.5">
                        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />

                        <div className="text-xs leading-relaxed text-blue-800">
                            Enter the 6-digit code from your email.
                            The code expires automatically.
                        </div>
                    </div>
                </div>

                <div className="flex justify-center gap-2">
                    {Array.from({
                        length: CODE_LENGTH,
                    }).map((_, index) => (
                        <input
                            key={index}
                            ref={(element) => {
                                inputRefs.current[
                                    index
                                ] = element;
                            }}
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={1}
                            value={digits[index]}
                            onChange={(event) =>
                                handleChange(
                                    index,
                                    event.target
                                        .value
                                )
                            }
                            onKeyDown={(event) =>
                                handleKeyDown(
                                    index,
                                    event
                                )
                            }
                            disabled={
                                isVerifying ||
                                locked ||
                                expired
                            }
                            className="h-12 w-11 rounded-lg border border-line bg-transparent text-center font-mono text-lg font-semibold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
                        />
                    ))}
                </div>

                <div className="mt-4 text-center text-xs text-muted">
                    {expired ? (
                        <span className="text-red-600">
                            Code expired. Please request a new code.
                        </span>
                    ) : (
                        <>
                            Expires in{" "}
                            <span className="font-mono font-semibold text-ink">
                                {formatTime(
                                    secondsLeft
                                )}
                            </span>
                        </>
                    )}
                </div>

                <div className="mt-2 text-center text-xs text-muted">
                    Attempts left:{" "}
                    <span className="font-semibold text-ink">
                        {attemptsLeft}
                    </span>{" "}
                    of {MAX_ATTEMPTS}
                </div>

                {error && (
                    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {error}
                    </div>
                )}

                {locked && (
                    <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        <Lock className="h-4 w-4" />
                        Account temporarily locked. Try again in{" "}
                        {formatTime(
                            lockedSeconds
                        )}
                        .
                    </div>
                )}

                <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isVerifying}
                        className="rounded-lg border border-line px-4 py-2 text-xs font-medium text-ink hover:bg-black/5 disabled:opacity-50"
                    >
                        Cancel
                    </button>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleResend}
                            disabled={
                                isSending ||
                                cooldown >
                                    0 ||
                                locked
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-accent hover:bg-accent/5 disabled:opacity-50"
                        >
                            {isSending ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <RefreshCw className="h-3.5 w-3.5" />
                            )}

                            {cooldown >
                            0
                                ? `Resend in ${cooldown}s`
                                : "Resend code"}
                        </button>

                        <button
                            type="button"
                            onClick={handleVerify}
                            disabled={
                                code.length !==
                                    CODE_LENGTH ||
                                isVerifying ||
                                expired ||
                                locked
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-xs font-medium text-paper hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isVerifying && (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            )}

                            {isVerifying
                                ? "Verifying..."
                                : "Verify"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}