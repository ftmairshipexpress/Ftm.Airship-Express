"use client";

import { useState } from "react";
import { Loader2, ShieldCheck, Pencil, X, Key, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  updateCustomer,
  type UpdateCustomerFormState,
  type UpdateCustomerResult,
} from "@/app/(crbc)/actions/customer";
import { validateEmail, validatePhoneNumber } from "@/app/(crbc)/library/utils/validateEmail";
import PhilippineAddressSelect from "@/app/(crbc)/components/ui/PhilippineAddressSelect";
import OtpInput, { OTP_PATTERN } from "@/app/(crbc)/components/auth/OtpInput";

type Props = {
  id: string;
  full_name: string;
  phone: string | null | undefined;
  province: string | null | undefined;
  city: string | null | undefined;
  barangay: string | null | undefined;
  full_address: string | null | undefined;
  email: string | null | undefined;
  /**
   * True when a CRM `customers` record is linked to this account. False means
   * the customer master record is missing, so the address fields cannot be
   * saved yet.
   */
  hasCustomerRecord?: boolean;
  // MFA props
  mfa_enabled?: boolean;
  mfa_email_verified?: boolean;
};

type FormState = UpdateCustomerFormState & UpdateCustomerResult;

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-4 py-3.5 border-b border-line last:border-0">
      <label htmlFor={id} className="pt-2.5 text-xs font-medium text-muted uppercase tracking-wide">
        {label}
      </label>
      <div>{children}</div>
    </div>
  );
}

const inputCls = (disabled: boolean) =>
  `w-full px-3 py-2 rounded-lg border text-sm text-foreground transition-colors outline-none
  ${disabled
    ? "border-transparent bg-transparent text-foreground cursor-default select-none"
    : "border-line bg-primary-foreground focus:border-accent focus:ring-2 focus:ring-accent/15"
  }`;

export default function SettingsForm({
  id,
  full_name,
  phone,
  province,
  city,
  barangay,
  full_address,
  email,
  hasCustomerRecord = true,
  mfa_enabled = false,
  mfa_email_verified = false
}: Props) {
  const initialState: FormState = {
    id,
    full_name,
    phone: phone ?? "",
    province: province ?? "",
    city: city ?? "",
    barangay: barangay ?? "",
    full_address: full_address ?? "",
    email: email ?? "",
  };

  const saved = {
    full_name,
    phone: phone ?? "",
    province: province ?? "",
    city: city ?? "",
    barangay: barangay ?? "",
    full_address: full_address ?? "",
    email: email ?? "",
  };

  const [formValues, setFormValues] = useState(saved);
  const [lastSavedValues, setLastSavedValues] = useState(saved);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // MFA state
  const [mfaEnabled, setMfaEnabled] = useState(mfa_enabled);
  const [mfaVerified, setMfaVerified] = useState(mfa_email_verified);
  const [mfaAction, setMfaAction] = useState<"idle" | "enable_password" | "enabling" | "disable_sending" | "disable_verifying" | "disabling">("idle");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [mfaPassword, setMfaPassword] = useState("");

  const handleChange = (name: string, value: string) =>
    setFormValues((prev) => ({ ...prev, [name]: value }));

  const handleCancel = () => {
    setFormValues(lastSavedValues);
    setIsEditing(false);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!formValues.full_name.trim()) return toast.error("Full name is required");
    if (!validateEmail(formValues.email)) return toast.error("Please enter a valid email address");
    if (formValues.phone && !validatePhoneNumber(formValues.phone))
      return toast.error("Please enter a valid Philippine phone number (e.g., 09xx-xxx-xxxx)");

    setIsSubmitting(true);

    // Fail fast with a clear message rather than posting a record the server
    // will reject. The action resolves ownership from the session, so a missing
    // CRM record cannot be saved no matter what the browser sends.
    if (!hasCustomerRecord) {
      setIsSubmitting(false);
      return toast.error(
        "No customer record is linked to your account yet. Please contact support.",
      );
    }

    const formData = new FormData();
    formData.set("full_name", formValues.full_name.trim());
    formData.set("phone", formValues.phone || "");
    formData.set("province", formValues.province || "");
    formData.set("city", formValues.city || "");
    formData.set("barangay", formValues.barangay || "");
    formData.set("full_address", formValues.full_address || "");
    formData.set("email", formValues.email.trim());

    const result = await updateCustomer(initialState, formData);

    if (result.success) {
      setLastSavedValues(formValues);
      setIsEditing(false);
      toast.success("Profile updated successfully!");
    } else {
      setFormValues(lastSavedValues);
      toast.error(result.error || "Failed to update profile");
    }

    setIsSubmitting(false);
  };

  // MFA Handlers
  // Enable MFA: password only, no OTP
  const handleEnableMfa = () => {
    setMfaAction("enable_password");
    setMfaError("");
    setMfaPassword("");
  };

  const handleVerifyEnableMfa = async () => {
    if (!mfaPassword) {
      setMfaError("Please enter your password");
      return;
    }

    setMfaAction("enabling");
    setMfaError("");

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
        setMfaVerified(true);
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

  // Disable MFA: first request an OTP for this session user
  const handleDisableMfa = async () => {
    setMfaAction("disable_sending");
    setMfaError("");

    try {
      const sendRes = await fetch("/api/auth/mfa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "disable" }),
      });

      const sendData = await sendRes.json();

      if (!sendData.success) {
        setMfaAction("idle");
        if (sendData.retryAfterSeconds) {
          const minutes = Math.ceil(sendData.retryAfterSeconds / 60);
          toast.error(`Too many requests. Please try again in ${minutes} minute${minutes !== 1 ? "s" : ""}.`);
        } else {
          toast.error(sendData.error || "Failed to send code");
        }
        return;
      }

      setMfaCode("");
      toast.success("Verification code sent to your email");
      setMfaAction("disable_verifying");
    } catch {
      setMfaAction("idle");
      toast.error("Failed to send code");
    }
  };

  // Disable MFA: requires BOTH the 6-digit OTP and the password
  const handleVerifyDisableMfa = async () => {
    if (!OTP_PATTERN.test(mfaCode)) {
      setMfaError("Please enter the 6-digit code");
      return;
    }
    if (!mfaPassword) {
      setMfaError("Please enter your password to disable MFA");
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
          password: mfaPassword
        }),
      });

      const data = await res.json();

      if (data.success) {
        setMfaEnabled(false);
        setMfaVerified(false);
        setMfaAction("idle");
        setMfaCode("");
        setMfaPassword("");
        setShowBackupCodes(false);
        setBackupCodes([]);
        toast.success("Two-factor authentication disabled");
      } else {
        toast.error(data.error || "Failed to disable MFA");
        setMfaAction("disable_verifying"); // Stay in verify state
      }
    } catch {
      toast.error("Failed to disable MFA");
      setMfaAction("disable_verifying");
    }
  };

  const handleResendMfaCode = async () => {
    try {
      const res = await fetch("/api/auth/mfa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "disable" }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success("New code sent");
      } else {
        if (data.retryAfterSeconds) {
          const minutes = Math.ceil(data.retryAfterSeconds / 60);
          toast.error(`Too many requests. Please try again in ${minutes} minute${minutes !== 1 ? "s" : ""}.`);
        } else {
          toast.error(data.error || "Failed to resend");
        }
      }
    } catch {
      toast.error("Failed to resend code");
    }
  };

  const copyBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join("\n"));
    toast.success("Backup codes copied!");
  };

  return (
    <div className="mx-auto max-w-2xl py-10 px-4 space-y-3">

      {/* Page heading */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-foreground">Account Settings</h1>
        <p className="text-sm text-muted mt-0.5">Manage your profile and security preferences.</p>
      </div>

      {/* Profile card */}
      <form onSubmit={handleSubmit}>
        <div className={`rounded-2xl border bg-background transition-colors ${isEditing ? "border-accent/40" : "border-line"}`}>

          {/* Card header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-line">
            <span className="text-sm font-medium text-foreground">Profile</span>
            {!isEditing ? (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted border border-line hover:text-foreground hover:border-muted/50 transition-colors"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted border border-line hover:text-foreground hover:border-muted/50 transition-colors"
              >
                <X className="h-3 w-3" />
                Cancel
              </button>
            )}
          </div>

          {/* Fields */}
          <div className="px-6">
            <Field label="Full name" id="full_name">
              <input
                id="full_name"
                name="full_name"
                type="text"
                value={formValues.full_name}
                onChange={(e) => handleChange("full_name", e.target.value)}
                disabled={!isEditing}
                required
                className={inputCls(!isEditing)}
              />
            </Field>

            <Field label="Email" id="email">
              <input
                id="email"
                name="email"
                type="email"
                value={formValues.email}
                onChange={(e) => handleChange("email", e.target.value)}
                disabled={!isEditing}
                required
                className={inputCls(!isEditing)}
              />
            </Field>

            <Field label="Phone" id="phone">
              <input
                id="phone"
                name="phone"
                type="tel"
                value={formValues.phone}
                onChange={(e) => handleChange("phone", e.target.value)}
                disabled={!isEditing}
                placeholder={isEditing ? "09xx-xxx-xxxx" : "—"}
                className={inputCls(!isEditing)}
              />
            </Field>

            <Field label="Province" id="province">
              {isEditing ? (
                <PhilippineAddressSelect
                  namePrefix="settings"
                  initialValues={{
                    province: formValues.province ? { name: formValues.province, regionCode: "", regionName: "" } : undefined,
                    municipality: formValues.city ? { name: formValues.city, provinceName: "", regionCode: "" } : undefined,
                    barangay: formValues.barangay ? { name: formValues.barangay, municipalityName: "", provinceName: "", regionCode: "" } : undefined,
                  }}
                  onChange={(sel) => {
                    handleChange("province", sel.province?.name || "");
                    handleChange("city", sel.municipality?.name || "");
                    handleChange("barangay", sel.barangay?.name || "");
                  }}
                />
              ) : (
                <div className="space-y-2 py-1">
                  {[
                    { label: "Province", value: formValues.province },
                    { label: "City", value: formValues.city },
                    { label: "Barangay", value: formValues.barangay },
                  ].map(({ label, value }) => (
                    <div key={label} className="grid grid-cols-[100px_1fr] text-sm">
                      <span className="text-muted text-xs">{label}</span>
                      <span className="text-foreground">{value || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </Field>

            <Field label="Full Address" id="full_address">
              <textarea
                id="full_address"
                name="full_address"
                value={formValues.full_address}
                onChange={(e) => handleChange("full_address", e.target.value)}
                disabled={!isEditing}
                placeholder={isEditing ? "House/unit no., street name" : "—"}
                rows={2}
                className={`${inputCls(!isEditing)} resize-none`}
              />
            </Field>
          </div>

          {/* Footer — only visible in edit mode */}
          {isEditing && (
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-line bg-primary-foreground/40 rounded-b-2xl">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-primary hover:bg-foreground/90 text-primary-foreground px-5 py-2 text-sm font-medium text-foreground active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </button>
            </div>
          )}
        </div>
      </form>

      {/* Security card */}
      <div className="rounded-2xl border border-line bg-background">
        <div className="px-6 py-4 border-b border-line">
          <span className="text-sm font-medium text-foreground">Security</span>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Two-factor authentication */}
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-center gap-3 flex-1">
                <div className={`p-2 rounded-lg ${mfaEnabled ? "bg-green-100 dark:bg-green-950/30" : "bg-muted/30"}`}>
                  <ShieldCheck className={`h-5 w-5 ${mfaEnabled ? "text-green-600 dark:text-green-400" : "text-muted"}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Two-factor authentication</p>
                  <p className="text-xs text-muted mt-0.5">
                    {mfaEnabled
                      ? "Enabled — A verification code will be sent to your email on each sign in."
                      : "Disabled — Add an extra layer of security to your account."}
                  </p>
                  {mfaEnabled && !mfaVerified && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Pending verification — check your email
                    </p>
                  )}
                </div>
              </div>
              {!mfaEnabled ? (
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
                  onClick={handleDisableMfa}
                  disabled={mfaAction !== "idle"}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border border-line text-muted hover:bg-accent/5 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {mfaAction === "disable_sending" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Disable 2FA
                </button>
              )}
            </div>

            {/* MFA Enable Flow - password only, no OTP */}
            {(mfaAction === "enable_password" || mfaAction === "enabling") && (
              <div className="p-4 rounded-lg bg-accent/5 border border-accent/20 space-y-3">
                <p className="text-sm text-foreground">
                  Confirm your password to enable two-factor authentication.
                </p>
                <div>
                  <label htmlFor="mfa-enable-password" className="block text-xs font-medium text-muted mb-1.5">
                    Password (required)
                  </label>
                  <input
                    id="mfa-enable-password"
                    type="password"
                    value={mfaPassword}
                    onChange={(e) => {
                      setMfaPassword(e.target.value);
                      if (mfaError) setMfaError("");
                    }}
                    disabled={mfaAction === "enabling"}
                    autoComplete="current-password"
                    className="w-full px-3 py-2 rounded-lg border border-line bg-background text-foreground focus:border-accent focus:ring-2 focus:ring-accent/15 outline-none disabled:opacity-60"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleVerifyEnableMfa}
                    disabled={mfaAction === "enabling" || !mfaPassword}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {mfaAction === "enabling" && <Loader2 className="h-4 w-4 animate-spin" />}
                    Enable 2FA
                  </button>
                  <button
                    onClick={() => { setMfaAction("idle"); setMfaPassword(""); setMfaError(""); }}
                    className="text-sm text-muted hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
                {mfaError && (
                  <p className="text-sm text-red-600 dark:text-red-400">{mfaError}</p>
                )}
              </div>
            )}

            {/* MFA Disable Flow */}
            {(mfaAction === "disable_sending" || mfaAction === "disable_verifying") && (
              <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/30 space-y-3">
                <p className="text-sm text-foreground">
                  {mfaAction === "disable_sending"
                    ? "Sending verification code to your email..."
                    : "Enter the 6-digit code sent to your email to disable 2FA."}
                </p>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">6-digit code (required)</label>
                  <OtpInput
                    value={mfaCode}
                    onChange={(v) => {
                      setMfaCode(v);
                      if (mfaError) setMfaError("");
                    }}
                    disabled={mfaAction !== "disable_verifying"}
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
                      onClick={handleVerifyDisableMfa}
                      disabled={!OTP_PATTERN.test(mfaCode) || !mfaPassword || mfaAction !== "disable_verifying"}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Disable 2FA
                    </button>
                    <button
                      onClick={handleResendMfaCode}
                      disabled={mfaAction !== "disable_verifying"}
                      className="text-sm text-accent hover:underline disabled:text-muted disabled:cursor-not-allowed"
                    >
                      Resend code
                    </button>
                    <button
                      onClick={() => { setMfaAction("idle"); setMfaCode(""); setMfaPassword(""); setMfaError(""); }}
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

            {/* Backup Codes Display */}
            {showBackupCodes && backupCodes.length > 0 && (
              <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/30 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    Backup Codes
                  </p>
                  <button
                    onClick={() => setShowBackupCodes(false)}
                    className="text-sm text-muted hover:text-foreground"
                  >
                    Hide
                  </button>
                </div>
                <p className="text-xs text-muted">
                  Save these codes in a safe place. Each code can be used once to access your account if you lose access to your email.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {backupCodes.map((code, i) => (
                    <code key={i} className="px-2 py-1.5 text-xs font-mono bg-background border border-line rounded text-center">
                      {code}
                    </code>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={copyBackupCodes}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-line hover:bg-accent/5 transition-colors"
                  >
                    Copy All
                  </button>
                  <button
                    onClick={() => setShowBackupCodes(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted hover:text-foreground"
                  >
                    I&apos;ve Saved Them
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}