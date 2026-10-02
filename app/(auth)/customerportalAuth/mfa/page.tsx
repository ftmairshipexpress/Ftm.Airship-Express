"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Loader2, Mail, AlertCircle } from "lucide-react";
import { logout } from "@/app/(crbc)/actions/auth";
import OtpInput, { OTP_PATTERN } from "@/app/(crbc)/components/auth/OtpInput";

export default function CustomerMfaPage() {
  const router = useRouter();

  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [mfaPending, setMfaPending] = useState(false);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setInterval(() => {
        setResendCooldown((prev) => Math.max(0, prev - 1));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [resendCooldown]);

  const sendOtp = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/mfa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "login" }),
      });

      const data = await res.json();

      if (data.success) {
        setResendCooldown(60);
        return true;
      }

      setError(data.error || "Failed to send code. Click Resend to try again.");
      if (data.retryAfterSeconds) {
        setResendCooldown(data.retryAfterSeconds);
      }
      return false;
    } catch {
      setError("Failed to send code. Click Resend to try again.");
      return false;
    }
  }, []);

  // Check session, validate the MFA challenge, then auto-send the OTP
  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      setIsLoading(true);
      setError("");

      try {
        const res = await fetch("/api/auth/mfa/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        const data = await res.json();

        if (cancelled) return;

        if (data.success && data.user) {
          setMaskedEmail(data.user.email.replace(/(.{2}).*(@.*)/, "$1***$2"));
          setMfaPending(true);
          setIsLoading(false);

          // Auto-send OTP
          await sendOtp();
        } else if (data.redirectTo === "dashboard") {
          router.push("/customer/dashboard");
          router.refresh();
        } else {
          router.push("/customerportalAuth/login");
          router.refresh();
        }
      } catch {
        if (cancelled) return;
        router.push("/customerportalAuth/login");
        router.refresh();
      }
    };

    checkSession();

    return () => {
      cancelled = true;
    };
  }, [router, sendOtp]);

  const handleResend = async () => {
    if (resendCooldown > 0 || isLoading) return;

    setError("");
    setIsLoading(true);

    try {
      await sendOtp();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaPending || !OTP_PATTERN.test(code)) return;

    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, purpose: "login" }),
      });

      const data = await res.json();

      if (data.success) {
        router.push(data.redirectTo || "/customer/dashboard");
        router.refresh();
      } else {
        setError(data.error || "Invalid code. Please try again.");
        setCode("");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToLogin = async () => {
    setIsLoading(true);
    await logout();
    router.push("/customerportalAuth/login");
    router.refresh();
  };

  if (isLoading && !mfaPending) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!mfaPending) {
    return null; 
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left: Brand panel */}
      <div className="hidden lg:flex lg:w-[42%] relative bg-accent/5 flex-col p-12 overflow-hidden">
        <svg
          className="absolute -bottom-24 -left-24 w-130 h-130 opacity-[0.35] pointer-events-none"
          viewBox="0 0 520 520"
          fill="none"
        >
          <path
            d="M 20 420 Q 260 60 500 240"
            stroke="var(--color-accent)"
            strokeWidth="1.5"
            strokeDasharray="2 10"
            strokeLinecap="round"
          />
        </svg>

        <div className="flex items-center gap-3 relative z-10">
          <Image src="/images/airship.png" alt="Logo" width={100} height={100} className="h-auto" />
        </div>

        <div className="relative z-10 max-w-sm mb-auto mt-auto">
          <h1 className="text-foreground text-2xl font-semibold leading-snug">
            Customer Portal
          </h1>
          <p className="text-muted text-sm mt-3">
            Verify your identity to access your dashboard.
          </p>
        </div>
      </div>

      {/* Right: MFA Form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-4">
              <Mail className="h-8 w-8 text-accent" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">Two-Factor Authentication</h1>
            <p className="text-muted mt-2">
              Enter the 6-digit code sent to <span className="text-foreground font-medium">{maskedEmail}</span>
            </p>
          </div>

          {error && (
            <div className="mb-6 flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-6">
              <OtpInput
                value={code}
                onChange={(v) => {
                  setCode(v);
                  if (error) setError("");
                }}
                disabled={isLoading}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !OTP_PATTERN.test(code)}
              className="w-full py-3 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify &amp; Continue"
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted">
              Didn&apos;t receive the code?
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0 || isLoading}
                className="ml-2 text-accent hover:underline disabled:text-muted disabled:cursor-not-allowed font-medium"
              >
                {resendCooldown > 0
                  ? `Resend in ${resendCooldown}s`
                  : "Resend code"}
              </button>
            </p>
          </div>

          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={handleBackToLogin}
              disabled={isLoading}
              className="text-sm text-muted hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              &larr; Back to login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
