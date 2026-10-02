"use client";

import CustomerNavbar from "./CustomerSidebar";
import type { User } from "@supabase/supabase-js";
import type { Customers as Customer } from "../../types/customer";

type CustomerLayoutProps = {
  children: React.ReactNode;
  user: User;
  /**
   * The CRM/sender master record. Null for an online customer who has not
   * submitted a shipment request yet — that is a valid portal state, not an
   * error, so the shell must render without it.
   */
  customer: Customer | null;
};

export default function CustomerLayout({ children, user, customer }: CustomerLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <CustomerNavbar customer={customer} user={user} />
      <main className="pt-14 px-4 md:px-8 overflow-x-auto">
        {children}
      </main>
    </div>
  );
}
