import { NextRequest } from "next/server";

export function isServiceCall(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const crbcApiKey = process.env.CRBC_API_KEY;
  if (!crbcApiKey || !authHeader) return false;
  const expected = `Bearer ${crbcApiKey}`.trim();
  const actual = authHeader.trim();
  return actual === expected;
}
