"use client";

import React, { useEffect, useState } from "react";
import { useTheme } from "@/app/components/ThemeProvider";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Moon,
  Shield,
  Sun,
  User,
  X,
} from "lucide-react";

type SecurityView =
  | "menu"
  | "change-password"
  | "change-email"
  | "password-otp"
  | "email-otp"
  | "success";


type ModalShellProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  disabled?: boolean;
};

function ModalShell({
  title,
  subtitle,
  children,
  onClose,
  disabled = false,
}: ModalShellProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-[2px]">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5 md:p-6">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[#e5167e]">
              <Shield className="h-4 w-4" />
              <span className="text-[10px] font-extrabold uppercase tracking-[0.16em]">
                Account Security
              </span>
            </div>
            <h2 className="text-xl font-extrabold tracking-tight text-foreground">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={disabled}
            className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto p-5 md:p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const [securityOpen, setSecurityOpen] = useState(false);
  const [securityView, setSecurityView] = useState<SecurityView>("menu");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpId, setOtpId] = useState("");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const resetSecurity = () => {
    setSecurityView("menu");
    setNewPassword("");
    setConfirmPassword("");
    setNewEmail("");
    setOtp("");
    setOtpId("");
    setMessage("");
    setBusy(false);
  };

  const closeSecurity = () => {
    if (busy) return;
    setSecurityOpen(false);
    resetSecurity();
  };

  const openSecurity = () => {
    resetSecurity();
    setSecurityOpen(true);
  };

  const beginPasswordChange = () => {
    setMessage("");
    setSecurityView("change-password");
  };

  const beginEmailChange = () => {
    setMessage("");
    setSecurityView("change-email");
  };

  const requestPasswordOtp = async () => {
    setMessage("");

    if (newPassword.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/settings/security/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "send",
          purpose: "change_password",
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        setMessage(data?.error ?? "Unable to send the verification code.");
        return;
      }

      setOtpId(data.otp_id);
      setOtp("");
      setSecurityView("password-otp");
      setMessage("A 6-digit verification code was sent to your registered email.");
    } catch (error) {
      console.error("Password OTP request failed:", error);
      setMessage("Something went wrong while sending the verification code.");
    } finally {
      setBusy(false);
    }
  };

  const requestEmailOtp = async () => {
    setMessage("");

    if (!newEmail.trim()) {
      setMessage("Enter a new email address.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setMessage("Enter a valid email address.");
      return;
    }

    setBusy(true);
    try {
      // Backend wiring will be added next.
      setSecurityView("email-otp");
      setMessage("Verification code will be sent to the new email address.");
    } finally {
      setBusy(false);
    }
  };

  const verifyPasswordOtp = async () => {
    setMessage("");

    if (otp.trim().length !== 6) {
      setMessage("Enter the 6-digit verification code.");
      return;
    }

    if (!otpId) {
      setMessage("Verification session is missing. Please request a new code.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/settings/security/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "verify",
          otp_id: otpId,
          code: otp.trim(),
          new_password: newPassword,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        setMessage(data?.error ?? "The verification code could not be accepted.");
        return;
      }

      setSecurityView("success");
      setMessage("Your password has been successfully updated.");
    } catch (error) {
      console.error("Password OTP verification failed:", error);
      setMessage("Something went wrong while verifying the code.");
    } finally {
      setBusy(false);
    }
  };

  const verifyEmailOtp = async () => {
    setMessage("");

    if (otp.trim().length !== 6) {
      setMessage("Enter the 6-digit verification code.");
      return;
    }

    setBusy(true);
    try {
      // Backend wiring will be added next.
      setSecurityView("success");
      setMessage("Email verification flow is ready for API integration.");
    } finally {
      setBusy(false);
    }
  };

  const securityCard = [
    {
      icon: User,
      title: "Profile & User Info",
      desc: "Manage your account details and display name.",
      configure: undefined,
    },
    {
      icon: Lock,
      title: "Security & Passwords",
      desc: "Manage your password and email address with OTP verification.",
      configure: openSecurity,
    },
    {
      icon: Bell,
      title: "Notification Preferences",
      desc: "Configure email alerts for overdue accounts and postings.",
      configure: undefined,
    },
    {
      icon: Shield,
      title: "Financial Ledger Rules",
      desc: "Set approval thresholds and period-closing locks.",
      configure: undefined,
    },
  ];

  const inputClass =
    "w-full rounded-xl border border-border bg-background px-3.5 py-3 text-sm text-foreground outline-none transition focus:border-[#e5167e] focus:ring-2 focus:ring-[#e5167e]/20";

  const primaryButton =
    "inline-flex items-center justify-center gap-2 rounded-xl bg-[#e5167e] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#e5167e]/90 disabled:cursor-not-allowed disabled:opacity-50";

  const secondaryButton =
    "inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-xs font-bold text-foreground transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50";



  return (
    <div className="min-h-screen bg-background p-6 text-foreground transition-colors duration-200 md:p-10">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* Header */}
        <div className="border-b border-border pb-5">
          <span className="text-xs font-extrabold uppercase tracking-widest text-[#e5167e] dark:text-[#ff4d9b]">
            Preferences
          </span>
          <h1 className="mt-0.5 text-3xl font-extrabold tracking-tight text-foreground">
            System Settings
          </h1>
          <p className="mt-0.5 text-sm text-foreground/60">
            Manage system theme appearance, user profiles, and financial ledger
            rules.
          </p>
        </div>

        <div className="space-y-6">
          {/* Theme */}
          <div className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm transition-all">
            <div>
              <h3 className="text-base font-bold text-foreground">
                App Theme Appearance
              </h3>
              <p className="text-xs text-foreground/60">
                Select your visual mode. This changes all submodules, navigation,
                and page layouts immediately.
              </p>
            </div>

            <div className="grid max-w-md grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-bold transition-all ${
                  theme === "light"
                    ? "border-[#e5167e] bg-[#e5167e] text-white shadow-md"
                    : "border-border bg-background text-foreground hover:border-[#e5167e]/50"
                }`}
              >
                <Sun size={16} /> Light Mode
              </button>

              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-bold transition-all ${
                  theme === "dark"
                    ? "border-[#e5167e] bg-[#e5167e] text-white shadow-md"
                    : "border-border bg-background text-foreground hover:border-[#e5167e]/50"
                }`}
              >
                <Moon size={16} /> Dark Mode
              </button>
            </div>
          </div>

          {/* Other settings */}
          {securityCard.map((setting, i) => {
            const Icon = setting.icon;

            return (
              <div
                key={setting.title}
                className="flex items-center justify-between rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:border-[#e5167e]/40"
              >
                <div className="flex items-center gap-4">
                  <div className="rounded-xl border border-border bg-background p-3 text-[#e5167e] dark:text-[#ff4d9b]">
                    <Icon size={20} />
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-foreground">
                      {setting.title}
                    </h3>
                    <p className="text-xs text-foreground/60">
                      {setting.desc}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={setting.configure}
                  disabled={!setting.configure}
                  className="rounded-xl border border-border bg-background px-4 py-2 text-xs font-bold text-foreground transition hover:bg-muted/50 disabled:cursor-default disabled:opacity-60"
                >
                  Configure
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {securityOpen && (
        <ModalShell
          onClose={closeSecurity}
          disabled={busy}
          title={
            securityView === "menu"
              ? "Security & Passwords"
              : securityView === "change-password"
                ? "Change Password"
                : securityView === "change-email"
                  ? "Change Email"
                  : securityView === "password-otp" || securityView === "email-otp"
                    ? "Verify OTP"
                    : "Security Update"
          }
          subtitle={
            securityView === "menu"
              ? "Protect your account and manage sensitive sign-in information."
              : securityView === "change-password"
                ? "Choose a new password for your FMS account."
                : securityView === "change-email"
                  ? "Update the email address used for your FMS account."
                  : securityView === "password-otp"
                    ? "Enter the 6-digit code sent to your registered email."
                    : securityView === "email-otp"
                      ? "Enter the 6-digit code sent to your new email address."
                      : "Your security action has been completed."
          }
        >
          {securityView === "menu" && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={beginPasswordChange}
                className="group flex w-full items-center justify-between rounded-xl border border-border bg-background p-4 text-left transition hover:border-[#e5167e]/40 hover:bg-muted/20"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-xl border border-border bg-card p-2.5 text-[#e5167e]">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      Change Password
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Update your account password after OTP verification.
                    </p>
                  </div>
                </div>

                <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
              </button>

              <button
                type="button"
                onClick={beginEmailChange}
                className="group flex w-full items-center justify-between rounded-xl border border-border bg-background p-4 text-left transition hover:border-[#e5167e]/40 hover:bg-muted/20"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-xl border border-border bg-card p-2.5 text-[#e5167e]">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      Change Email
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Update your account email after verification.
                    </p>
                  </div>
                </div>

                <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
              </button>
            </div>
          )}

          {securityView === "change-password" && (
            <div className="space-y-5">
              <div className="rounded-xl border border-[#e5167e]/20 bg-[#e5167e]/5 p-4">
                <div className="flex items-start gap-3">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#e5167e]" />
                  <p className="text-xs leading-relaxed text-foreground/70">
                    After you submit the new password, the system will require
                    OTP verification before the password is changed.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-foreground">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={inputClass}
                    placeholder="Enter new password"
                    autoComplete="off"
                    name="fms-new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-bwignore="true"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={
                      showNewPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-foreground">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={inputClass}
                    placeholder="Re-enter new password"
                    autoComplete="off"
                    name="fms-confirm-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-bwignore="true"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={
                      showConfirmPassword
                        ? "Hide password"
                        : "Show password"
                    }
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {message && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-3 text-xs text-amber-700 dark:text-amber-300">
                  {message}
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setSecurityView("menu")}
                  disabled={busy}
                  className={secondaryButton}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={requestPasswordOtp}
                  disabled={busy}
                  className={primaryButton}
                >
                  Send Verification Code
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {securityView === "change-email" && (
            <div className="space-y-5">
              <div className="rounded-xl border border-[#e5167e]/20 bg-[#e5167e]/5 p-4">
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#e5167e]" />
                  <p className="text-xs leading-relaxed text-foreground/70">
                    A verification code will be sent to the new email address
                    before the account email is updated.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-foreground">
                  New Email Address
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className={inputClass}
                  placeholder="name@example.com"
                  autoComplete="email"
                />
              </div>

              {message && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-3 text-xs text-amber-700 dark:text-amber-300">
                  {message}
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setSecurityView("menu")}
                  disabled={busy}
                  className={secondaryButton}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={requestEmailOtp}
                  disabled={busy}
                  className={primaryButton}
                >
                  Send Verification Code
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {(securityView === "password-otp" ||
            securityView === "email-otp") && (
            <div className="space-y-5">
              <div className="flex flex-col items-center rounded-xl border border-border bg-background p-5 text-center">
                <div className="mb-3 rounded-full bg-[#e5167e]/10 p-3 text-[#e5167e]">
                  <Mail className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-bold text-foreground">
                  Enter Verification Code
                </h3>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                  Enter the 6-digit code sent to your registered email. The code
                  is required before the password can be changed.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-foreground">
                  Verification Code
                </label>
                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className={`${inputClass} text-center font-mono text-lg tracking-[0.45em]`}
                  placeholder="000000"
                  autoComplete="one-time-code"
                />
              </div>

              {message && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-3 text-xs text-amber-700 dark:text-amber-300">
                  {message}
                </div>
              )}

              <div className="flex justify-between gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() =>
                    setSecurityView(
                      securityView === "password-otp"
                        ? "change-password"
                        : "change-email"
                    )
                  }
                  disabled={busy}
                  className={secondaryButton}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>

                <button
                  type="button"
                  onClick={
                    securityView === "password-otp"
                      ? verifyPasswordOtp
                      : verifyEmailOtp
                  }
                  disabled={busy}
                  className={primaryButton}
                >
                  Verify Code
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {securityView === "success" && (
            <div className="space-y-5 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-7 w-7" />
              </div>

              <div>
                <h3 className="text-lg font-extrabold text-foreground">
                  Security Flow Ready
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {message}
                </p>
              </div>

              <button
                type="button"
                onClick={closeSecurity}
                className={primaryButton}
              >
                Done
              </button>
            </div>
          )}
        </ModalShell>
      )}
    </div>
  );
}
