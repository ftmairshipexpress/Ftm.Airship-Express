import type { SlaTier } from "../types/sla";


export const SLA_TIERS: readonly SlaTier[] = ["Metro Manila", "Province"];

export function isSlaTier(value: unknown): value is SlaTier {
  return typeof value === "string" && (SLA_TIERS as readonly string[]).includes(value);
}

export type DeliveryPolicyInput = {
  policy: string;
  coverage: string;
  region: SlaTier;
  minDays: number;
  maxDays: number;
};

export async function createDeliveryPolicy(data: DeliveryPolicyInput) {
  const response = await fetch("/api/deliverypolicy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const policy = await response.json();

  if (!response.ok) {
    throw new Error(policy.error);
  }

  return policy;
}

export async function updateDeliveryPolicy(data: DeliveryPolicyInput & { id: string }) {
  const response = await fetch("/api/deliverypolicy", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const policy = await response.json();

  if (!response.ok) {
    throw new Error(policy.error);
  }

  return policy;
}

export async function getDeliveryPolicies() {
  const response = await fetch("/api/deliverypolicy");
  if (!response.ok) {
    throw new Error("Failed to fetch delivery policies");
  }

  return await response.json();
}
