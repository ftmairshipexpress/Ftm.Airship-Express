import { redirect } from "next/navigation";
import { createClient } from "@/app/(crbc)/library/supabase/server";
import { bootstrapPortalCustomer } from "@/app/(crbc)/library/auth/bootstrap-customer";

/**
 * PKCE email-confirmation callback.
 *
 * Supabase emails a link ending in `?code=<pkce_code>`. The code arrives in the
 * query string, so this runs server-side. `exchangeCodeForSession` confirms the
 * email and establishes the session (cookies set here) using the normal
 * anon/publishable server client - RLS then applies normally, and auth.uid()
 * is a real, non-null value by the time we write.
 *
 * This is the PRIMARY bootstrap point for portal accounts. Email confirmation is
 * enabled, so signUp() returns no session and cannot reliably create RLS-
 * protected rows. Here we hold a real session, so the profile and CRM customer
 * records can be created.
 *
 * Bootstrap is delegated to `bootstrapPortalCustomer`, which is idempotent and
 * shared with the login backstop.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  if (!code) {
    redirect("/customerportalAuth/verify-email");
  }

  const supabase = await createClient();

  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    // Expired, already-consumed, or invalid link.
    console.error("Confirmation exchange error:", exchangeError.message);
    redirect("/customerportalAuth/verify-email?error=expired");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/customerportalAuth/verify-email");
  }

  // Ensure profile + CRM customer master record exist. Idempotent: a retried
  // confirmation, a double-clicked link, or a partially completed signup all
  // converge on the same single record.
  const result = await bootstrapPortalCustomer();

  if (!result.ok) {
    console.error("Portal bootstrap failed:", result.error);
    redirect("/customerportalAuth/verify-email?error=profile");
  }

  redirect("/customer/dashboard");
}
