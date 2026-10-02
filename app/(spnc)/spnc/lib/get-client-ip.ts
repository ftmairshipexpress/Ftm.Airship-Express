import { isIP } from "node:net";

function normalizeIp(value: string | null | undefined) {
  if (!value) return null;

  let candidate = value.trim().replace(/^"|"$/g, "");
  if (candidate.startsWith("[")) {
    const closingBracket = candidate.indexOf("]");
    if (closingBracket !== -1) candidate = candidate.slice(1, closingBracket);
  }

  if (isIP(candidate)) return candidate;

  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/);
  return ipv4WithPort && isIP(ipv4WithPort[1]) === 4 ? ipv4WithPort[1] : null;
}

// Loopback / private addresses are never useful as an "audit" IP — treat them as absent
// so a later, more specific header (or a real proxy) gets a chance to supply the real one.
function isRoutable(ip: string | null) {
  if (!ip) return false;
  if (ip === "::1" || ip === "127.0.0.1") return false;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return false;
  return true;
}

// Parses the standard `Forwarded` header (RFC 7239): for=1.2.3.4;proto=https;by=...
function parseForwardedHeader(value: string | null) {
  if (!value) return null;
  const first = value.split(",")[0];
  const match = first.match(/for=([^;]+)/i);
  return match ? normalizeIp(match[1]) : null;
}

export function resolveClientIp(request?: Request) {
  if (!request) return null;

  const headers = request.headers;
  const forwardedForFirst = headers.get("x-forwarded-for")?.split(",")[0] ?? null;

  const candidates = [
    // Cloudflare
    normalizeIp(headers.get("cf-connecting-ip")),
    // Vercel
    normalizeIp(headers.get("x-vercel-forwarded-for")?.split(",")[0]),
    // Fly.io
    normalizeIp(headers.get("fly-client-ip")),
    // Common reverse proxies (nginx, most CDNs)
    normalizeIp(headers.get("x-real-ip")),
    normalizeIp(forwardedForFirst),
    // Standard RFC 7239 header
    parseForwardedHeader(headers.get("forwarded")),
    // Some runtimes attach the client IP directly to the request.
    normalizeIp((request as Request & { ip?: string | null }).ip ?? null),
  ];

  const routable = candidates.find(isRoutable);
  if (routable) return routable;

  // Nothing routable found — fall back to whatever we got (even if it's loopback),
  // so local dev/testing still logs something rather than null.
  return candidates.find((ip) => ip !== null) ?? null;
}