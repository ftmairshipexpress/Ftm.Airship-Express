import { redirect } from "next/navigation";

export default function SupplierPortalPORedirect() {
    redirect("/suppliers_page/purchase-orders");
}
