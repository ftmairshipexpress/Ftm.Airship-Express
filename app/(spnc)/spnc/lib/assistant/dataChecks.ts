// Quick automatic pre-checks on contact details and names.
// They don't create alerts themselves: they attach "flags" to each row so the AI scan
// doesn't overlook them. The AI confirms each flag and writes the alert.

const COMMON_DOMAINS = [
  "gmail.com", "yahoo.com", "yahoo.com.ph", "outlook.com", "hotmail.com", "live.com", "icloud.com",
  "ymail.com", "proton.me", "protonmail.com", "aol.com", "msn.com",
];
const TYPO_TLDS = /\.(con|cm|co|om|cpm|vom|comm|coom|cim|xom|c)$/i;
const PLACEHOLDER = /^(test|testing|sample|example|demo|dummy|asdf|asd|qwe|qwerty|abc|xyz|aaa+|zzz+|na|n\/a|none|null|nil|-+|\.+|x+|tbd|tba|temp|foo|bar|dad|dadad+|sdf|fds|hello|hi)$/i;

/** Edit distance, for spotting misspelled domains like "gmial.com" */
function distance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export function emailIssue(raw: unknown): string | null {
  if (raw == null || String(raw).trim() === "") return null;
  const v = String(raw).trim();
  const local = v.split("@")[0]?.toLowerCase() ?? "";
  if (/\s/.test(v)) return `email "${v}" contains spaces`;
  const at = (v.match(/@/g) ?? []).length;
  if (at === 0) return `email "${v}" has no @ (not an email address)`;
  if (at > 1) return `email "${v}" has more than one @`;
  const [user, domain] = v.split("@");
  if (!user) return `email "${v}" has nothing before the @`;
  if (!domain || !domain.includes(".")) return `email "${v}" has no valid domain (e.g. @gmail.com)`;
  if (/\.\.|^\.|\.$/.test(domain) || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return `email "${v}" has an invalid domain`;
  const d = domain.toLowerCase();
  if (!COMMON_DOMAINS.includes(d)) {
    // gmial.com, gmail.con, yaho.com …
    for (const good of COMMON_DOMAINS) {
      const dist = distance(d, good);
      if (dist > 0 && dist <= 2 && d.length >= 6) return `email domain "${d}" looks misspelled, probably "${good}" (${user}@${good})`;
    }
    const base = d.replace(TYPO_TLDS, ".com");
    if (TYPO_TLDS.test(d) && COMMON_DOMAINS.includes(base)) return `email domain "${d}" looks misspelled, probably "${base}"`;
  }
  if (PLACEHOLDER.test(local) || /^(test|sample|example|asdf)/i.test(local)) return `email "${v}" looks like a test/placeholder address`;
  return null;
}

export function phoneIssue(raw: unknown): string | null {
  if (raw == null || String(raw).trim() === "") return null;
  const v = String(raw).trim();
  if (/[a-z]/i.test(v)) return `phone "${v}" contains letters`;
  const digits = v.replace(/\D/g, "");
  if (/^(\d)\1+$/.test(digits) || ["1234567890", "0123456789", "09123456789"].includes(digits)) return `phone "${v}" looks fake`;
  let national = digits;
  if (digits.startsWith("63")) national = "0" + digits.slice(2);
  // Mobile: 09XXXXXXXXX (11 digits). Landline: 02 + 8 digits (10), or area code + 7 digits (10).
  const mobileOk = /^09\d{9}$/.test(national);
  const landlineOk = /^0(2\d{8}|[3-8]\d{8})$/.test(national);
  if (mobileOk || landlineOk) return null;
  if (national.startsWith("09")) return `phone "${v}" has ${national.length} digits; a PH mobile needs 11 (09XX XXX XXXX / +63 9XX XXX XXXX)`;
  return `phone "${v}" is not a valid Philippine number`;
}

export function nameIssue(raw: unknown, label = "name"): string | null {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  const compact = v.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (PLACEHOLDER.test(v) || PLACEHOLDER.test(compact)) return `${label} "${v}" looks like a test/placeholder value`;
  if (/^(.{1,3})\1{1,}$/i.test(compact)) return `${label} "${v}" looks like keyboard mashing`;
  if (/^[^aeiou]{5,}$/i.test(compact)) return `${label} "${v}" looks like random letters`;
  return null;
}

/** Near-duplicate names (e.g. "Luzon Haulers" vs "Luzon Haulers Inc.") */
export function duplicateNames(rows: { id: unknown; name?: unknown }[]): Map<string, string> {
  const out = new Map<string, string>();
  const norm = (s: string) => s.toLowerCase().replace(/\b(inc|corp|corporation|co|ltd|llc|company)\b/g, "").replace(/[^a-z0-9]/g, "");
  const list = rows.filter((r) => r.name).map((r) => ({ id: String(r.id), name: String(r.name), key: norm(String(r.name)) }));
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!a.key || !b.key) continue;
      if (a.key === b.key || (a.key.length > 5 && distance(a.key, b.key) <= 1)) {
        out.set(b.id, `name "${b.name}" is a near-duplicate of "${a.name}"`);
      }
    }
  return out;
}

/** Whole days from "today" (YYYY-MM-DD) to a date (negative = in the past). */
function daysFrom(today: string, date: string) {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null;
}

/**
 * Automatic pre-checks for one SOP (standard operating procedure).
 * Requests (pending/declined rows) only get the name checks; they aren't live SOPs yet.
 */
export function sopIssues(
  s: { title?: unknown; sop_code?: unknown; owner?: unknown; department?: unknown; content?: unknown; status?: unknown; effective_date?: unknown; review_date?: unknown },
  today: string
): string[] {
  const out: string[] = [];
  const status = String(s.status ?? "").toLowerCase();
  const isRequest = status === "pending" || status === "declined";
  const eff = s.effective_date ? String(s.effective_date).slice(0, 10) : "";
  const rev = s.review_date ? String(s.review_date).slice(0, 10) : "";

  const t = nameIssue(s.title, "SOP title");
  if (t) out.push(t);
  const o = nameIssue(s.owner, "owner");
  if (o) out.push(o);
  if (isRequest) return out;

  if (rev) {
    const d = daysFrom(today, rev);
    if (d !== null && d < 0) out.push(`review date ${rev} passed ${-d} day${d === -1 ? "" : "s"} ago (SOP review overdue)`);
    else if (d !== null && d <= 7) out.push(`review date ${rev} is ${d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`} (review due soon)`);
  } else {
    out.push("no review date set");
  }
  if (eff && rev && rev <= eff) out.push(`review date ${rev} is not after the effective date ${eff}`);
  if (eff) {
    const d = daysFrom(today, eff);
    if (d !== null && d > 0 && status === "published") out.push(`published but only takes effect on ${eff} (in ${d} days)`);
  }
  if (!String(s.owner ?? "").trim()) out.push("no owner (nobody is responsible for this SOP)");
  if (!String(s.department ?? "").trim()) out.push("no department set");
  if (!String(s.content ?? "").trim()) out.push("no procedure content (the SOP is empty)");
  else if (String(s.content).trim().length < 20) out.push(`procedure content is only "${String(s.content).trim()}" (too short to follow)`);
  return out;
}

/** Same SOP code used twice, or near-identical titles. */
export function duplicateSops(rows: { id?: unknown; sop_code?: unknown; title?: unknown }[]): Map<string, string> {
  const out = new Map<string, string>();
  const codes = new Map<string, { id: string; code: string }>();
  for (const r of rows) {
    const code = String(r.sop_code ?? "").trim();
    if (!code) continue;
    const key = code.toLowerCase();
    const first = codes.get(key);
    if (first) out.set(String(r.id), `SOP code "${code}" is already used by another SOP`);
    else codes.set(key, { id: String(r.id), code });
  }
  for (const [id, msg] of duplicateNames(rows.map((r) => ({ id: r.id, name: r.title })))) {
    if (!out.has(id)) out.set(id, msg.replace(/^name/, "SOP title"));
  }
  return out;
}