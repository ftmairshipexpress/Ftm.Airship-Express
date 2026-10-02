export type CustomerStatus = "Active" | "Inactive";

export type CustomerAddress = {
  province: string | null;
  city: string | null;
  barangay: string | null;
  full_address: string | null;
};

export type Customers = {
  id: string;
  customer_id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  province?: string | null;
  city?: string | null;
  barangay?: string | null;
  full_address?: string | null;
  role: string;
  created_at: string;
  profile_id?: string | null;
  auth_user_id?: string | null; 
};

export interface Customer {
  customerId: string;
  fullName: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  status: CustomerStatus;
  registeredDate: string;
  lastActivityDate: string;
}
