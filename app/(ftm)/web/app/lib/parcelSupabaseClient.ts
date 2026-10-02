import { supabase } from "./supabaseClient";
import { getCachedSupabaseClient } from "../../lib/supabaseClientFactory";

const parcelSupabaseUrl = process.env.NEXT_PUBLIC_FTM_PARCEL_SUPABASE_URL || process.env.NEXT_PUBLIC_PARCEL_SUPABASE_URL;
const parcelSupabaseAnonKey = process.env.NEXT_PUBLIC_FTM_PARCEL_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_PARCEL_SUPABASE_ANON_KEY;

export const parcelSupabase = parcelSupabaseUrl && parcelSupabaseAnonKey
	? getCachedSupabaseClient(parcelSupabaseUrl, parcelSupabaseAnonKey)
	: supabase;
