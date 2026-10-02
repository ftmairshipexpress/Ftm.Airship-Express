import { getCurrentUser } from "@/app/(crbc)/library/auth/getCurrentUser";
import { redirect } from "next/navigation";
import ProfileManagement from "../../components/customer/ProfileManagement";

export const metadata = {
  title: "Profile"
};

export default async function ProfileManagementPage() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect("/customerportalAuth/login");
  }

  if (currentUser.profile.role !== "customer") {
    redirect("/crbc/dashboard");
  }

  // Without a CRM record, fall back to the authenticated profile so the page
  // still renders. Editing the CRM fields is a separate flow.
  const customer = currentUser.customer;

  return (
    <ProfileManagement
      customer_id={customer?.customer_id ?? ""}
      full_name={customer?.full_name ?? currentUser.profile.full_name ?? ""}
      phone={customer?.phone}
      province={customer?.province}
      city={customer?.city}
      barangay={customer?.barangay}
      full_address={customer?.full_address}
      email={customer?.email ?? currentUser.profile.email}
    />
  );
}