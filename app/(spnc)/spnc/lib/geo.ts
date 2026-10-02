// Server-side geo helpers for trip tracking (geocoding + road routing).
//
// Free by default, no API key needed:
//   - Geocoding: OpenStreetMap Nominatim
//   - Road routing: OSRM
// Optional: set GOOGLE_MAPS_API_KEY to geocode with Google instead (better for PH street addresses).
//
// Env (all optional):
//   GOOGLE_MAPS_API_KEY   use Google Geocoding API instead of Nominatim
//   GEOCODER_URL          default https://nominatim.openstreetmap.org
//   GEOCODE_COUNTRY       ISO country code(s) to bias results, default "ph"
//   GEOCODER_USER_AGENT   Nominatim requires an identifying User-Agent
//   OSRM_URL              default https://router.project-osrm.org

export type LatLng = [number, number]; // [lat, lng]

const GEOCODER_URL = process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org";
const GEOCODE_COUNTRY = process.env.GEOCODE_COUNTRY ?? "ph";
const USER_AGENT = process.env.GEOCODER_USER_AGENT || "SPNC-Logistics/1.0 (trip tracking)";
const OSRM_URL = process.env.OSRM_URL || "https://router.project-osrm.org";
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;

const TIMEOUT_MS = 8000;

// In-memory cache for the life of the server process (DB is the long-term cache).
const geocodeCache = new Map<string, LatLng | null>();

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  const a = Number(lat);
  const b = Number(lng);
  return (
    lat !== null &&
    lng !== null &&
    lat !== "" &&
    lng !== "" &&
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a) <= 90 &&
    Math.abs(b) <= 180
  );
}

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Accepts "14.7131, 121.0752" typed directly as a location. */
function parseCoordText(text: string): LatLng | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return isValidLatLng(m[1], m[2]) ? [Number(m[1]), Number(m[2])] : null;
}

/** Turns a place name / address into coordinates. Returns null when nothing is found. */
export async function geocode(query?: string | null): Promise<LatLng | null> {
  const q = (query || "").trim();
  if (!q) return null;

  const direct = parseCoordText(q);
  if (direct) return direct;

  const key = q.toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;

  // Try the full text first, then simpler versions:
  // "Batangas City (XYZ Mart)" -> "Batangas City"; "SLEX Calamba" -> "Calamba"; "A, B, C" -> "B, C" -> "C".
  let result: LatLng | null = null;
  const candidates = geocodeCandidates(q);
  for (let i = 0; i < candidates.length && !result; i++) {
    if (i > 0 && !GOOGLE_KEY) await new Promise((r) => setTimeout(r, 1100)); // Nominatim: 1 request/second
    result = await geocodeOnce(candidates[i]);
  }

  geocodeCache.set(key, result);
  return result;
}

export function geocodeCandidates(q: string): string[] {
  const out: string[] = [q];
  const add = (s: string) => {
    const v = s.replace(/\s+/g, " ").replace(/^[\s,·-]+|[\s,·-]+$/g, "").trim();
    const generic = /^(city|town|municipality|province|tollway|expressway|road|highway|exit|warehouse|port)$/i.test(v);
    if (v.length >= 3 && !generic && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  // drop "(…)" / "[…]" notes like "(warehouse)" or "(XYZ Mart)"
  const noParens = q.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  add(noParens);
  // drop road/landmark prefixes common in PH logistics notes
  add(noParens.replace(/\b(SLEX|NLEX|SCTEX|TPLEX|CAVITEX|STAR Tollway|Skyway|EDSA|C-5|toll ?plaza|exit|junction|brgy\.?|barangay)\b/gi, " "));
  // progressively drop the most specific comma part: "A, B, C" -> "B, C" -> "C"
  const parts = noParens.split(",").map((p) => p.trim()).filter(Boolean);
  for (let i = 1; i < parts.length; i++) add(parts.slice(i).join(", "));
  // last resort: the last word(s), usually the city
  const words = noParens.trim().split(/\s+/);
  if (words.length > 1) add(words.slice(-2).join(" "));
  if (words.length > 1) add(words[words.length - 1]);
  return out.slice(0, 4); // keep it quick
}

async function geocodeOnce(q: string): Promise<LatLng | null> {
  let result: LatLng | null = null;
  if (GOOGLE_KEY) {
    const params = new URLSearchParams({ address: q, key: GOOGLE_KEY });
    if (GEOCODE_COUNTRY) params.set("components", `country:${GEOCODE_COUNTRY.split(",")[0].toUpperCase()}`);
    const data = await fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    const loc = data?.results?.[0]?.geometry?.location;
    if (loc && isValidLatLng(loc.lat, loc.lng)) result = [loc.lat, loc.lng];
  } else {
    const params = new URLSearchParams({ q, format: "json", limit: "1" });
    if (GEOCODE_COUNTRY) params.set("countrycodes", GEOCODE_COUNTRY);
    const data = await fetchJson(`${GEOCODER_URL}/search?${params}`, {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en",
    });
    const hit = Array.isArray(data) ? data[0] : null;
    if (hit && isValidLatLng(hit.lat, hit.lon)) result = [Number(hit.lat), Number(hit.lon)];
  }
  return result;
}

/** Coordinates -> short place label, e.g. "Novaliches, Quezon City". */
export async function reverseGeocode([lat, lng]: LatLng): Promise<string | null> {
  if (GOOGLE_KEY) {
    const params = new URLSearchParams({ latlng: `${lat},${lng}`, key: GOOGLE_KEY });
    const data = await fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    return data?.results?.[0]?.formatted_address ?? null;
  }
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: "json", zoom: "16" });
  const data = await fetchJson(`${GEOCODER_URL}/reverse?${params}`, {
    "User-Agent": USER_AGENT,
    "Accept-Language": "en",
  });
  const a = data?.address;
  if (!a) return data?.display_name ?? null;
  const parts = [
    a.road,
    a.suburb || a.quarter || a.neighbourhood || a.village,
    a.city || a.town || a.municipality,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : data?.display_name ?? null;
}

/**
 * Road path through the given points, in order. Falls back to straight
 * segments if the routing service can't be reached.
 */
export async function roadPath(points: LatLng[]): Promise<{ path: LatLng[]; snapped: boolean }> {
  if (points.length < 2) return { path: points, snapped: false };

  // OSRM accepts up to ~100 waypoints on the public server; thin out if needed.
  const step = Math.ceil(points.length / 90);
  const pts = points.filter((_, i) => i % step === 0 || i === points.length - 1);

  const coords = pts.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
  const data = await fetchJson(`${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`);
  const line: [number, number][] | undefined = data?.routes?.[0]?.geometry?.coordinates;

  if (data?.code === "Ok" && Array.isArray(line) && line.length > 1) {
    return { path: line.map(([lng, lat]) => [lat, lng] as LatLng), snapped: true };
  }
  return { path: points, snapped: false };
}

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Stable key for a list of points, used to know when the cached road path is stale. */
export function pathKey(points: LatLng[]): string {
  return points.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join("|");
}