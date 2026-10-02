"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/app/components/ThemeToggle";
import { Shield, Bell, User, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import OtpInput, { OTP_PATTERN } from "@/app/(crbc)/components/auth/OtpInput";

type Props = {
  isMfaEnabled: boolean;
  mfaEmailVerified: boolean;
};

export default function StaffSettingsClient({ isMfaEnabled: initialMfaEnabled, mfaEmailVerified }: Props) {
  const router = useRouter();
  const [mfaAction, setMfaAction] = useState<
    "idle" | "enable_password" | "enabling" | "disabling" | "disable_sending" | "verifying"
  >("idle");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [mfaPassword, setMfaPassword] = useState("");
  const [isMfaEnabled, setMfaEnabled] = useState(initialMfaEnabled);

  // Enable MFA: password only, no OTP
  const handleEnableMfa = () => {
    setMfaAction("enable_password");
    setMfaError("");
    setMfaPassword("");
  };

  const handleCancelEnableMfa = () => {
    setMfaAction("idle");
    setMfaPassword("");
    setMfaError("");
  };

  const handleConfirmEnableMfa = async () => {
    if (!mfaPassword) {
      setMfaError("Please enter your password");
      return;
    }

    setMfaError("");
    setMfaAction("enabling");

    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: mfaPassword,
          action: "enable_with_password",
        }),
      });

      const data = await res.json();

      if (data.success) {
        setMfaEnabled(true);
        setMfaAction("idle");
        setMfaPassword("");
        toast.success("Two-factor authentication enabled!");
      } else {
        setMfaAction("enable_password");
        toast.error(data.error || "Failed to enable MFA");
      }
    } catch {
      setMfaAction("enable_password");
      toast.error("Failed to enable MFA");
    }
  };

  // Disable MFA: request a fresh OTP (server sends to the session user)
  const handleSendDisableCode = async () => {
    setMfaAction("disable_sending");
    setMfaError("");

    try {
      const res = await fetch("/api/auth/mfa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "disable" }),
      });

      const data = await res.json();

      if (data.success) {
        setMfaCode("");
        setMfaAction("verifying");
        toast.success("Verification code sent to your email");
      } else {
        setMfaAction("idle");
        if (data.retryAfterSeconds) {
          const minutes = Math.ceil(data.retryAfterSeconds / 60);
          toast.error(`Too many requests. Please try again in ${minutes} minute${minutes !== 1 ? "s" : ""}.`);
        } else {
          toast.error(data.error || "Failed to send code");
        }
      }
    } catch {
      setMfaAction("idle");
      toast.error("Failed to send code");
    }
  };

  // Disable MFA: requires BOTH the 6-digit OTP and the password
  const handleDisableMfa = async () => {
    if (!mfaPassword) {
      setMfaError("Please enter your password to disable MFA");
      return;
    }
    if (!OTP_PATTERN.test(mfaCode)) {
      setMfaError("Please enter the 6-digit code");
      return;
    }

    setMfaAction("disabling");
    setMfaError("");

    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: mfaCode,
          purpose: "disable",
          action: "disable",
          password: mfaPassword,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setMfaEnabled(false);
        setMfaAction("idle");
        setMfaCode("");
        setMfaPassword("");
        toast.success("Two-factor authentication disabled");
      } else {
        setMfaAction("verifying");
        toast.error(data.error || "Failed to disable MFA");
      }
    } catch {
      setMfaAction("verifying");
      toast.error("Failed to disable MFA");
    }
  };

  return (
    <div className="w-full py-4 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="text-muted text-sm mt-1">
          Manage your account preferences and security.
        </p>
      </div>

      <section className="bg-background border border-line rounded-2xl overflow-hidden">
        <div className="px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-foreground text-sm font-semibold">Appearance</h2>
              <p className="text-muted text-xs mt-1 max-w-sm leading-relaxed">
                Toggle between light and dark mode.
              </p>
            </div>
            <ThemeToggle className="cursor-pointer" />
          </div>
        </div>
      </section>

      <section className="bg-background border border-line rounded-2xl overflow-hidden">
        <div className="px-5 py-5 sm:px-6">
          <h2 className="text-foreground text-sm font-semibold mb-4">Account</h2>
          <div className="space-y-3">
            <button
              className="w-full flex items-center gap-3 rounded-lg p-3 text-left hover:bg-accent/5 transition-colors"
              onClick={() => router.push("/crbc/settings/security")}
            >
              <Shield size={18} className="text-accent shrink-0" />
              <div>
                <p className="text-foreground text-sm font-medium">Security</p>
                <p className="text-muted text-xs">Password, 2FA, and sessions</p>
              </div>
            </button>
            <button className="w-full flex items-center gap-3 rounded-lg p-3 text-left hover:bg-accent/5 transition-colors">
              <Bell size={18} className="text-accent shrink-0" />
              <div>
                <p className="text-foreground text-sm font-medium">Notifications</p>
                <p className="text-muted text-xs">Email and push preferences</p>
              </div>
            </button>
            <button className="w-full flex items-center gap-3 rounded-lg p-3 text-left hover:bg-accent/5 transition-colors">
              <User size={18} className="text-accent shrink-0" />
              <div>
                <p className="text-foreground text-sm font-medium">Profile</p>
                <p className="text-muted text-xs">Name, avatar, and contact info</p>
              </div>
            </button>
          </div>
        </div>
      </section>

      {/* MFA Section for Staff */}
      <section className="bg-background border border-line rounded-2xl overflow-hidden">
        <div className="px-5 py-5 sm:px-6">
          <h2 className="text-foreground text-sm font-semibold mb-4">Two-Factor Authentication</h2>
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-center gap-3 flex-1">
                <div className={`p-2 rounded-lg ${isMfaEnabled ? "bg-green-100 dark:bg-green-950/30" : "bg-muted/30"}`}>
                  <Shield className={`h-5 w-5 ${isMfaEnabled ? "text-green-600 dark:text-green-400" : "text-muted"}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Two-factor authentication</p>
                  <p className="text-xs text-muted mt-0.5">
                    {isMfaEnabled
                      ? "Enabled — A verification code will be sent to your email on each sign in."
                      : "Disabled — Add an extra layer of security to your account."}
                  </p>
                  {isMfaEnabled && !mfaEmailVerified && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Pending verification — check your email
                    </p>
                  )}
                </div>
              </div>
              {!isMfaEnabled ? (
                <button
                  onClick={handleEnableMfa}
                  disabled={mfaAction !== "idle"}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {mfaAction === "enabling" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Enable 2FA
                </button>
              ) : (
                <button
                  onClick={handleSendDisableCode}
                  disabled={mfaAction !== "idle"}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border border-line text-muted hover:bg-accent/5 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {(mfaAction === "disabling" || mfaAction === "disable_sending") && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  Disable 2FA
                </button>
              )}
            </div>

            {/* Enable MFA with Password Flow */}
            {mfaAction === "enable_password" && (
              <div className="p-4 rounded-lg bg-accent/5 border border-accent/20 space-y-3">
                <p className="text-sm text-foreground">
                  Enter your password to enable two-factor authentication.
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Password</label>
                    <input
                      type="password"
                      value={mfaPassword}
                      onChange={(e) => setMfaPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full px-3 py-2 rounded-lg border border-line bg-background text-sm focus:border-accent focus:ring-2 focus:ring-accent/15 outline-none"
                      autoComplete="current-password"
                      autoFocus
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleConfirmEnableMfa}
                      disabled={!mfaPassword}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Enable 2FA
                    </button>
                    <button
                      onClick={handleCancelEnableMfa}
                      className="text-sm text-muted hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                  {mfaError && (
                    <p className="text-sm text-red-600 dark:text-red-400">{mfaError}</p>
                  )}
                </div>
              </div>
            )}

            {/* MFA Disable Flow */}
            {(mfaAction === "verifying" || mfaAction === "disabling") && isMfaEnabled && (
              <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/30 space-y-3">
                <p className="text-sm text-foreground">
                  Enter a verification code from your email and your password to disable 2FA.
                </p>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">
                    6-digit code (required)
                  </label>
                  <OtpInput
                    value={mfaCode}
                    onChange={(v) => {
                      setMfaCode(v);
                      if (mfaError) setMfaError("");
                    }}
                    disabled={mfaAction === "disabling"}
                  />
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-muted mb-1.5">Password (required)</label>
                    <input
                      type="password"
                      value={mfaPassword}
                      onChange={(e) => setMfaPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full px-3 py-2 rounded-lg border border-line bg-background text-sm focus:border-accent focus:ring-2 focus:ring-accent/15 outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleDisableMfa}
                      disabled={!OTP_PATTERN.test(mfaCode) || !mfaPassword || mfaAction === "disabling"}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {mfaAction === "disabling" && <Loader2 className="h-4 w-4 animate-spin" />}
                      Disable 2FA
                    </button>
                    <button
                      onClick={() => {
                        setMfaAction("idle");
                        setMfaCode("");
                        setMfaPassword("");
                        setMfaError("");
                      }}
                      className="text-sm text-muted hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                  {mfaError && (
                    <p className="text-sm text-red-600 dark:text-red-400">{mfaError}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}