import { redirect } from "next/navigation";

export default function SupplierPortalRedirect() {
    redirect("/suppliers_page/purchase-orders");
}
