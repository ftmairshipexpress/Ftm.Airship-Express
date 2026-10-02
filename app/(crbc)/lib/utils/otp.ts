import { createHash } from "crypto";

// Generate cryptographically secure OTP
export function generateOtp(length: number = 6): string {
  const digits = "0123456789";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (x) => digits[x % digits.length]).join("");
}

// Hash OTP with SHA-256 (not bcrypt - OTP is short-lived, SHA-256 is fine)
export async function hashOtp(otp: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(otp);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Verify OTP against hash
export async function verifyOtp(otp: string, hash: string): Promise<boolean> {
  const computedHash = await hashOtp(otp);
  return computedHash === hash;
}

// Constant-time comparison (for future use if needed)
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}