import { AuthForm } from "@/app/(crbc)/components/auth/AuthForm"
import { customerServiceLogin as signIn } from "@/app/(crbc)/actions/auth"
import { redirect } from "next/navigation"
import Image from "next/image"
import { getCurrentUser } from "@/app/(crbc)/library/auth/getCurrentUser"
import AirshipExpressLogo from "../../../../public/images/airship.png"

export default async function StaffLogin() {
    const user = await getCurrentUser();

    // If authenticated staff but MFA enabled and not verified, redirect to MFA page
    if (user?.profile?.role === "staff") {
        if (user.profile.mfa_enabled && !user.profile.mfa_email_verified) {
            redirect("/crbcAuth/mfa");
        }
        redirect("/crbc/dashboard");
    }

    return (
        <div className="min-h-screen bg-background flex">

            {/* left: brand panel */}
            <div className="hidden lg:flex lg:w-[42%] relative bg-accent/5 flex-col p-12 overflow-hidden">
                <svg
                    className="absolute -bottom-24 -left-24 w-130 h-130 opacity-[0.35] pointer-events-none"
                    viewBox="0 0 520 520" fill="none"
                >
                    <path
                        d="M 20 420 Q 260 60 500 240"
                        stroke="var(--color-accent)" strokeWidth="1.5" strokeDasharray="2 10" strokeLinecap="round"
                    />
                </svg>

                <div className="flex items-center gap-3 relative z-10">
                    <Image src={AirshipExpressLogo} alt="Logo" width={100} height={100} className="h-auto" />
                </div>

                <div className="relative z-10 max-w-sm mb-auto mt-auto">
                    <h1 className="text-foreground text-3xl font-semibold leading-snug">
                        Customer Relationship &amp; Business Control.
                    </h1>
                    <p className="text-muted text-sm mt-3">
                        Manage accounts, support requests, and customer records, all in one place.
                    </p>
                </div>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center px-4">
                <div className="lg:hidden mb-8 flex items-center gap-3">
                    <Image src={AirshipExpressLogo} alt="Logo" width={100} height={100} className="h-auto" />
                </div>

                <div className="w-full max-w-sm">
                    <div className="mb-6">
                        <h1 className="text-foreground text-xl font-semibold">Staff Sign In</h1>
                        <p className="text-muted text-sm mt-1">Sign in with your staff credentials</p>
                    </div>

                    <AuthForm action={signIn} />

                    <p className="text-center text-muted text-xs mt-6">
                        Trouble accessing your account?{" "}
                        <a href="mailto:support@airship.com" className="text-accent hover:text-accent-dark transition-colors font-medium">
                            Contact support
                        </a>
                    </p>
                </div>

            </div>
        </div>
    )
}