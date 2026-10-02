import { redirect } from "next/navigation";

export default function SupplierRootPage() {
    redirect("/suppliers_page/purchase-orders");
}
