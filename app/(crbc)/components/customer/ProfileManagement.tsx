"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import Link from "next/link";

type Props = {
  customer_id: string;
  full_name: string;
  phone: string | null | undefined;
  province: string | null | undefined;
  city: string | null | undefined;
  barangay: string | null | undefined;
  full_address: string | null | undefined;
  email: string | null | undefined;
};

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group grid grid-cols-[140px_1fr_auto] items-start gap-4 py-3.5 border-b border-line last:border-0">
      <span className="pt-0.5 text-xs font-medium text-muted uppercase tracking-wide">
        {label}
      </span>
      <span
        className={`text-sm wrap-break-word ${
          value ? "text-foreground" : "text-muted/50 italic"
        } ${mono ? "font-mono" : ""}`}
      >
        {value ?? "Not provided"}
      </span>
      {value && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="mt-0.5 shrink-0 rounded-md p-1 text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-accent" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

export default function ProfileManagement({
  customer_id,
  full_name,
  phone,
  province,
  city,
  barangay,
  full_address,
  email,
}: Props) {
  const addressLine = [barangay, city, province].filter(Boolean).join(", ") || null;

  return (
    <div className="mx-auto max-w-2xl py-10 px-4 space-y-3">

      {/* Page heading */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-foreground">Profile</h1>
        <p className="text-sm text-muted mt-0.5">Your account information.</p>
      </div>

      {/* Details card */}
      <div className="rounded-2xl border border-line bg-background">
        <div className="px-6 py-4 border-b border-line">
          <span className="text-sm font-medium text-foreground">Personal Information</span>
        </div>
        <div className="px-6">
          <Row label="Full name" value={full_name} />
          <Row label="Customer ID" value={customer_id} mono />
          <Row label="Email" value={email} />
          <Row label="Phone" value={phone} />
          <Row label="Province" value={province} />
          <Row label="City" value={city} />
          <Row label="Barangay" value={barangay} />
          <Row label="Street" value={full_address} />
          {addressLine && <Row label="Full Address" value={addressLine} />}
        </div>
      </div>

      <p className="pt-1 text-xs text-muted">
        Need to update your details?{" "}
        <Link href="/customer/settings" className="text-accent hover:underline">
          Go to Settings
        </Link>
      </p>
    </div>
  );
}
