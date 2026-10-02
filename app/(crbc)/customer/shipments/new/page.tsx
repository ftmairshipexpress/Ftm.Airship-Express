import { getCurrentUser } from "../../../library/auth/getCurrentUser";
import RequestShipmentForm from "../../../components/customer/RequestShipmentForm";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Request Shipment",
};

export default async function RequestShipmentPage() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect("/customerportalAuth/login");
  }

  if (currentUser.profile.role !== "customer") {
    redirect("/crbc/dashboard");
  }

  // The form requires a non-null customer object. An online customer who has
  // no CRM record yet gets a profile-derived placeholder, NOT a database row.
  // Creating/linking the real sender record is handled by the booking flow.
  const customer = currentUser.customer;

  const customerData: import("../../../types/customer").Customers = customer ?? {
    id: currentUser.profile.id,
    customer_id: "",
    full_name: currentUser.profile.full_name ?? currentUser.profile.email,
    email: currentUser.profile.email,
    phone: null,
    province: null,
    city: null,
    barangay: null,
    full_address: null,
    role: "customer",
    created_at: currentUser.profile.id,
  };

  return (
    <div className="py-6">
      <RequestShipmentForm customer={customerData} />
    </div>
  );
}
