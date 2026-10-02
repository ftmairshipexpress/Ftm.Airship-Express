

import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { MailCheck, ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/app/(crbc)/library/auth/getCurrentUser";

export const metadata = {
  title: "Confirm your email",
};

export default async function VerifyEmailPage() {
  const user = await getCurrentUser();

  // Already confirmed and signed in - no need to see this page.
  if (user?.profile?.role === "customer" && user.authUser.email_confirmed_at) {
    redirect("/customer/dashboard");
  }

  // A different role belongs elsewhere.
  if (user && user.profile.role !== "customer") {
    redirect("/crbcAuth/login");
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* left: brand panel */}
      <div className="hidden lg:flex lg:w-[42%] relative bg-accent/5 flex-col p-12 overflow-hidden">
        <svg
          className="absolute -top-24 -right-24 w-130 h-130 opacity-[0.35] pointer-events-none"
          viewBox="0 0 520 520"
          fill="none"
        >
          <path
            d="M 20 100 Q 260 460 500 280"
            stroke="var(--color-accent)"
            strokeWidth="1.5"
            strokeDasharray="2 10"
            strokeLinecap="round"
          />
        </svg>

        <div className="flex items-center gap-3 relative z-10">
          <Image src="/images/airship.png" alt="Logo" width={36} height={36} className="h-auto" />
          <span className="text-foreground text-lg font-semibold tracking-wide">Airship</span>
        </div>

        <div className="relative z-10 max-w-sm mb-auto mt-auto">
          <p className="text-foreground text-2xl font-semibold leading-snug">
            Almost there — one quick step.
          </p>
          <p className="text-muted text-sm mt-3">
            Confirming your email keeps your account secure and lets us send you shipment updates.
          </p>
        </div>
      </div>

      {/* right: confirmation message */}
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="lg:hidden mb-8 flex items-center gap-3">
          <Image src="/images/airship.png" alt="Logo" width={36} height={36} className="h-auto" />
          <span className="text-foreground text-lg font-semibold tracking-wide">Airship</span>
        </div>

        <div className="w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-6">
            <MailCheck className="h-8 w-8 text-accent" />
          </div>

          <h1 className="text-foreground text-xl font-semibold">
            Please check your email to confirm your account.
          </h1>

          <div className="mt-5 space-y-2 text-muted text-sm text-left">
            <p>We sent a confirmation link to your email address.</p>
            <p>Please check your inbox and spam/junk folder.</p>
          </div>

          <p className="mt-4 text-muted text-xs">
            Click the link in that email to finish setting up your account. You&apos;ll be able to sign
            in once your email is confirmed.
          </p>

          <Link
            href="/customerportalAuth/login"
            className="mt-8 inline-flex items-center justify-center gap-2 w-full py-3 rounded-lg border border-line text-sm font-medium text-foreground hover:bg-accent/5 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Sign In
          </Link>
        </div>

        <p className="lg:hidden text-muted/70 text-xs mt-8">© 2026 Airship. All rights reserved.</p>
      </div>
    </div>
  );
}
