import phData from "@/app/(crbc)/data/philippines-addresses.json";

// Type the raw JSON data to satisfy TypeScript
type PhDataRaw = Record<string, {
  region_name: string;
  province_list: Record<string, {
    municipality_list: Record<string, {
      barangay_list: string[];
    }>;
  }>;
}>;

const data = phData as PhDataRaw;

export interface Region {
  code: string;
  name: string;
}

export interface Province {
  name: string;
  regionCode: string;
  regionName: string;
}

export interface Municipality {
  name: string;
  provinceName: string;
  regionCode: string;
}

export interface Barangay {
  name: string;
  municipalityName: string;
  provinceName: string;
  regionCode: string;
}

export interface AddressSelection {
  region: Region | null;
  province: Province | null;
  municipality: Municipality | null;
  barangay: Barangay | null;
}

// Cache for performance
let regionsCache: Region[] | null = null;
let provincesCache: Map<string, Province[]> | null = null;
let municipalitiesCache: Map<string, Municipality[]> | null = null;
let barangaysCache: Map<string, Barangay[]> | null = null;

/** Get all regions */
export function getRegions(): Region[] {
  if (regionsCache) return regionsCache;

  const regionNames: Record<string, string> = {
    "01": "REGION I (Ilocos Region)",
    "02": "REGION II (Cagayan Valley)",
    "03": "REGION III (Central Luzon)",
    "4A": "REGION IV-A (CALABARZON)",
    "4B": "REGION IV-B (MIMAROPA)",
    "05": "REGION V (Bicol Region)",
    "06": "REGION VI (Western Visayas)",
    "07": "REGION VII (Central Visayas)",
    "08": "REGION VIII (Eastern Visayas)",
    "09": "REGION IX (Zamboanga Peninsula)",
    "10": "REGION X (Northern Mindanao)",
    "11": "REGION XI (Davao Region)",
    "12": "REGION XII (SOCCSKSARGEN)",
    "13": "REGION XIII (Caraga)",
    "CAR": "Cordillera Administrative Region",
    "NCR": "National Capital Region",
    "ARMM": "Autonomous Region in Muslim Mindanao",
  };

  regionsCache = Object.entries(data).map(([code, region]) => ({
    code,
    name: regionNames[code] || region.region_name,
  }));

  return regionsCache;
}

/** Get all provinces across all regions (for flat province selector) */
export function getAllProvinces(): Province[] {
  const cacheKey = '__all__';
  if (provincesCache?.has(cacheKey)) return provincesCache.get(cacheKey)!;

  const allProvinces: Province[] = [];
  Object.entries(data).forEach(([regionCode, region]) => {
    Object.entries(region.province_list).forEach(([name]) => {
      allProvinces.push({ name, regionCode, regionName: region.region_name });
    });
  });

  if (!provincesCache) provincesCache = new Map();
  provincesCache.set(cacheKey, allProvinces);
  return allProvinces;
}

/** Get region code for a province (needed for municipality lookup) */
export function getRegionCodeForProvince(provinceName: string): string | null {
  for (const [regionCode, region] of Object.entries(data)) {
    if (region.province_list[provinceName]) {
      return regionCode;
    }
  }
  return null;
}

/** Get provinces for a region */
export function getProvinces(regionCode: string): Province[] {
  const cacheKey = regionCode;
  if (provincesCache?.has(cacheKey)) return provincesCache.get(cacheKey)!;

  const region = data[regionCode];
  if (!region) return [];

  const provinces = Object.entries(region.province_list).map(([name]) => ({
    name,
    regionCode,
    regionName: region.region_name,
  }));

  if (!provincesCache) provincesCache = new Map();
  provincesCache.set(cacheKey, provinces);
  return provinces;
}

/** Get municipalities for a province */
export function getMunicipalities(regionCode: string, provinceName: string): Municipality[] {
  const cacheKey = `${regionCode}|${provinceName}`;
  if (municipalitiesCache?.has(cacheKey)) return municipalitiesCache.get(cacheKey)!;

  const region = data[regionCode];
  const province = region?.province_list[provinceName];
  if (!province) return [];

  const municipalities = Object.entries(province.municipality_list).map(([name]) => ({
    name,
    provinceName,
    regionCode,
  }));

  if (!municipalitiesCache) municipalitiesCache = new Map();
  municipalitiesCache.set(cacheKey, municipalities);
  return municipalities;
}

/** Get barangays for a municipality */
export function getBarangays(regionCode: string, provinceName: string, municipalityName: string): Barangay[] {
  const cacheKey = `${regionCode}|${provinceName}|${municipalityName}`;
  if (barangaysCache?.has(cacheKey)) return barangaysCache.get(cacheKey)!;

  const region = data[regionCode];
  const province = region?.province_list[provinceName];
  const municipality = province?.municipality_list[municipalityName];
  if (!municipality) return [];

  const barangays = municipality.barangay_list.map((name: string) => ({
    name,
    municipalityName,
    provinceName,
    regionCode,
  }));

  if (!barangaysCache) barangaysCache = new Map();
  barangaysCache.set(cacheKey, barangays);
  return barangays;
}

interface AddressSearchResult {
  label: string;
  level: string;
  data: Region | Province | Municipality | Barangay;
}

/** Search across all levels (for autocomplete) */
export function searchAddresses(query: string, limit = 10): AddressSearchResult[] {
  const q = query.toLowerCase();
  const results: AddressSearchResult[] = [];

  // Search regions
  for (const region of getRegions()) {
    if (region.name.toLowerCase().includes(q) || region.code.toLowerCase().includes(q)) {
      results.push({ label: region.name, level: "region", data: region });
    }
  }

  // Search provinces
  for (const region of getRegions()) {
    for (const province of getProvinces(region.code)) {
      if (province.name.toLowerCase().includes(q)) {
        results.push({
          label: `${province.name}, ${region.name}`,
          level: "province",
          data: province
        });
      }
    }
  }

  // Search municipalities (limit search to avoid performance issues)
  for (const region of getRegions()) {
    for (const province of getProvinces(region.code)) {
      for (const municipality of getMunicipalities(region.code, province.name)) {
        if (municipality.name.toLowerCase().includes(q)) {
          results.push({
            label: `${municipality.name}, ${province.name}`,
            level: "municipality",
            data: municipality
          });
          if (results.length >= limit) return results;
        }
      }
    }
  }

  return results.slice(0, limit);
}

/** Build a formatted address string from selection */
export function formatAddress(selection: AddressSelection, includeRegion = false): string {
  const parts: string[] = [];
  if (selection.barangay) parts.push(selection.barangay.name);
  if (selection.municipality) parts.push(selection.municipality.name);
  if (selection.province) parts.push(selection.province.name);
  if (includeRegion && selection.region) parts.push(selection.region.name);
  return parts.join(", ");
}

/** Get region name from code */
export function getRegionName(code: string): string {
  return getRegions().find(r => r.code === code)?.name || code;
}

/** Validate a full address hierarchy exists */
export function validateAddress(selection: AddressSelection): boolean {
  if (!selection.region) return false;
  if (!selection.province) return false;
  if (!selection.municipality) return false;
  if (!selection.barangay) return false;

  const barangays = getBarangays(
    selection.region.code,
    selection.province.name,
    selection.municipality.name
  );
  return barangays.some(b => b.name === selection.barangay!.name);
}

/** Clear all caches (useful for testing) */
export function clearCache() {
  regionsCache = null;
  provincesCache = null;
  municipalitiesCache = null;
  barangaysCache = null;
}