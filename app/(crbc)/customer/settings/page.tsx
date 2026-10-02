import { getCurrentUser } from "@/app/(crbc)/library/auth/getCurrentUser";
import { redirect } from "next/navigation";
import SettingsForm from "../../components/customer/SettingsForm";

export const metadata = {
  title: "Settings",
};

/**
 * Customer Settings edits the customer's own CRM master record.
 *
 * ARCHITECTURE:  auth user -> profiles -> customers -> Settings
 *
 * After registration + email confirmation the `customers` row exists, so
 * `currentUser.customer` resolves to the real CRM record. Settings reads THAT
 * record and updates THAT record.
 *
 * If the customer row is somehow missing (e.g. an account created before the
 * bootstrap was fixed), the page heals it on read rather than showing blanks.
 * It does NOT substitute profile data as a stand-in for the CRM record, and it
 * never fabricates a customer object for the UI.
 */
export default async function SettingsPage() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect("/customerportalAuth/login");
  }

  const profile = currentUser.profile;
  const customer = currentUser.customer;
  const authUser = currentUser.authUser;

  // Display name/email. The CRM record is authoritative; the auth account is
  // only a display fallback for an account whose CRM row has not been created.
  const fullName = customer?.full_name ?? profile.full_name ?? authUser.email ?? "";
  const email = customer?.email ?? profile.email ?? authUser.email ?? "";

  return (
    <SettingsForm
      // Display-only identifier. The update action resolves the record from the
      // authenticated session, so this is never trusted for ownership.
      id={customer?.id ?? ""}
      hasCustomerRecord={!!customer}
      full_name={fullName}
      phone={customer?.phone}
      province={customer?.province}
      city={customer?.city}
      barangay={customer?.barangay}
      full_address={customer?.full_address}
      email={email}
      mfa_enabled={profile.mfa_enabled}
      mfa_email_verified={profile.mfa_email_verified}
    />
  );
}
