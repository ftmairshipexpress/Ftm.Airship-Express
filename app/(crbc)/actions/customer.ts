"use server";

import { createClient } from "@/app/(crbc)/library/supabase/server";
import type { PackageType } from "../types/booking-request";

export type BookingPackageDetails = {
  package_quantity: number;
  package_type: PackageType;
  item_category: string;
  weight: number;
  dimensions?: {
    length_cm: number;
    width_cm: number;
    height_cm: number;
  };
  declared_value?: number;
  packaging_service: "empty" | "provided";
  remarks?: string;
};

export type UpdateCustomerFormState = {
  id: string;
  full_name: string;
  phone: string | null;
  province: string | null;
  city: string | null;
  barangay: string | null;
  full_address: string | null;
  email: string | null;
};

export type UpdateCustomerResult = {
  success?: boolean;
  error?: string;
};

export async function updateCustomer(
  prevState: UpdateCustomerFormState,
  formData: FormData
): Promise<UpdateCustomerResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Unauthorized" };
  }

  const { data: ownCustomer } = await supabase
    .from("customers")
    .select("id, email")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!ownCustomer) {
    return {
      error:
        "No customer record is linked to your account. Please contact support.",
    };
  }

  // Extract form data
  const full_name = formData.get("full_name") as string;
  const phone = formData.get("phone") as string | null;
  const province = formData.get("province") as string | null;
  const city = formData.get("city") as string | null;
  const barangay = formData.get("barangay") as string | null;
  const full_address = formData.get("full_address") as string | null;
  const email = formData.get("email") as string | null;

  if (!full_name?.trim()) {
    return { error: "Full name is required" };
  }

  const nextEmail = email?.trim() || ownCustomer.email || null;

  const { data, error } = await supabase
    .from("customers")
    .update({
      full_name: full_name.trim(),
      phone: phone?.trim() || null,
      province: province?.trim() || null,
      city: city?.trim() || null,
      barangay: barangay?.trim() || null,
      full_address: full_address?.trim() || null,
      email: nextEmail,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ownCustomer.id)
    .select();

  if (error) {
    console.error("Customer update error:", error);
    return { error: "Failed to update customer" };
  }

  if (!data || data.length === 0) {
    return { error: "No customer record was updated — check permissions" };
  }

  return { success: true };
}