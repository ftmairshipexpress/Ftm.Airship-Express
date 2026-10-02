"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, MapPin, Loader2, X } from "lucide-react";
import {
  getAllProvinces,
  getMunicipalities,
  getBarangays,
  getRegionCodeForProvince,
  type Province,
  type Municipality,
  type Barangay,
  type AddressSelection,
} from "@/app/(crbc)/library/addresses/ph-addresses";

interface PhilippineAddressSelectProps {
  /** Initial values (e.g., from database) */
  initialValues?: Partial<AddressSelection>;
  /** Callback when selection changes */
  onChange?: (selection: AddressSelection) => void;
  /** Field names for form integration */
  namePrefix?: string;
  /** Require all levels */
  required?: boolean;
  /** Placeholder texts */
  placeholders?: {
    province?: string;
    city?: string;
    barangay?: string;
  };
  /** Disabled state */
  disabled?: boolean;
  /** Custom className */
  className?: string;
}

export default function PhilippineAddressSelect({
  initialValues = {},
  onChange,
  namePrefix = "address",
  required = false,
  placeholders = {
    province: "Select province",
    city: "Select city/municipality",
    barangay: "Select barangay",
  },
  disabled = false,
  className = "",
}: PhilippineAddressSelectProps) {
  const [selection, setSelection] = useState<AddressSelection>({
    region: initialValues.region ?? null,
    province: initialValues.province ?? null,
    municipality: initialValues.municipality ?? null,
    barangay: initialValues.barangay ?? null,
  });

  // Resolve placeholders with defaults to avoid undefined
  const resolvedPlaceholders = {
    province: placeholders.province ?? "Select province",
    city: placeholders.city ?? "Select city/municipality",
    barangay: placeholders.barangay ?? "Select barangay",
  };

  // Options loaded on demand
  const [options, setOptions] = useState({
    provinces: getAllProvinces(),
    municipalities: [] as Municipality[],
    barangays: [] as Barangay[],
  });

  const [loading, setLoading] = useState({
    province: false,
    municipality: false,
    barangay: false,
  });

  // Load dependent options when parent changes
  const loadMunicipalities = useCallback(async (provinceName: string) => {
    setLoading(prev => ({ ...prev, municipality: true }));
    await new Promise(r => setTimeout(r, 50));
    const regionCode = getRegionCodeForProvince(provinceName);
    if (regionCode) {
      setOptions(prev => ({
        ...prev,
        municipalities: getMunicipalities(regionCode, provinceName),
        barangays: [],
      }));
    }
    setLoading(prev => ({ ...prev, municipality: false }));
  }, []);

  const loadBarangays = useCallback(async (provinceName: string, municipalityName: string) => {
    setLoading(prev => ({ ...prev, barangay: true }));
    await new Promise(r => setTimeout(r, 50));
    const regionCode = getRegionCodeForProvince(provinceName);
    if (regionCode) {
      setOptions(prev => ({
        ...prev,
        barangays: getBarangays(regionCode, provinceName, municipalityName),
      }));
    }
    setLoading(prev => ({ ...prev, barangay: false }));
  }, []);

  // Effect: load initial dependent options from initialValues
  useEffect(() => {
    (async()=>{
      if (selection.province) {
            await loadMunicipalities(selection.province.name);
          }
          if (selection.province && selection.municipality) {
            await loadBarangays(selection.province.name, selection.municipality.name);
          }
    })();
  }, [
    selection.province,
    selection.municipality,
    loadMunicipalities,
    loadBarangays,
  ]); 

  const handleProvinceChange = (province: Province | null) => {
    const newSelection: AddressSelection = {
      region: null,
      province,
      municipality: null,
      barangay: null
    };
    setSelection(newSelection);
    setOptions(prev => ({ ...prev, municipalities: [], barangays: [] }));
    if (province) {
      loadMunicipalities(province.name);
    }
    onChange?.(newSelection);
  };

  const handleMunicipalityChange = (municipality: Municipality | null) => {
    const newSelection: AddressSelection = {
      region: null,
      province: selection.province,
      municipality,
      barangay: null
    };
    setSelection(newSelection);
    setOptions(prev => ({ ...prev, barangays: [] }));
    if (municipality && selection.province) {
      loadBarangays(selection.province.name, municipality.name);
    }
    onChange?.(newSelection);
  };

  const handleBarangayChange = (barangay: Barangay | null) => {
    const newSelection: AddressSelection = {
      region: null,
      province: selection.province,
      municipality: selection.municipality,
      barangay
    };
    setSelection(newSelection);
    onChange?.(newSelection);
  };

  const clearAll = () => {
    const newSelection: AddressSelection = { region: null, province: null, municipality: null, barangay: null };
    setSelection(newSelection);
    // Only clear dependent options, keep provinces loaded for re-selection
    setOptions(prev => ({ ...prev, municipalities: [], barangays: [] }));
    onChange?.(newSelection);
  };

  const hasSelection = selection.barangay || selection.municipality || selection.province;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Province Select */}
      <SelectField<Province>
        label="Province"
        name={`${namePrefix}_province`}
        value={selection.province}
        options={options.provinces}
        placeholder={resolvedPlaceholders.province}
        onChange={handleProvinceChange}
        required={required}
        disabled={disabled || loading.province}
        loading={loading.province}
        getLabel={(p) => p.name}
        getValue={(p) => p.name}
      />

      {/* City/Municipality Select */}
      <SelectField<Municipality>
        label="City / Municipality"
        name={`${namePrefix}_city`}
        value={selection.municipality}
        options={options.municipalities}
        placeholder={resolvedPlaceholders.city}
        onChange={handleMunicipalityChange}
        required={required}
        disabled={disabled || !selection.province || loading.municipality}
        loading={loading.municipality}
        getLabel={(m) => m.name}
        getValue={(m) => m.name}
      />

      {/* Barangay Select */}
      <SelectField<Barangay>
        label="Barangay"
        name={`${namePrefix}_barangay`}
        value={selection.barangay}
        options={options.barangays}
        placeholder={resolvedPlaceholders.barangay}
        onChange={handleBarangayChange}
        required={required}
        disabled={disabled || !selection.municipality || loading.barangay}
        loading={loading.barangay}
        getLabel={(b) => b.name}
        getValue={(b) => b.name}
      />

      {/* Display formatted address */}
      {(selection.barangay || selection.municipality || selection.province) && (
        <div className="mt-4 p-3 rounded-lg bg-muted/30 border border-line">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <MapPin size={14} />
            <span>Selected Address</span>
          </div>
          <p className="text-foreground text-sm font-medium">
            {selection.barangay?.name}, {selection.municipality?.name}, {selection.province?.name}
          </p>
          {hasSelection && (
            <button
              type="button"
              onClick={clearAll}
              className="mt-2 text-xs text-accent hover:underline flex items-center gap-1"
            >
              <X size={10} /> Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Generic SelectField component
function SelectField<T extends { name: string }>({
  label,
  name,
  value,
  options,
  placeholder,
  onChange,
  required = false,
  disabled = false,
  loading = false,
  getLabel,
  getValue,
}: {
  label: string;
  name: string;
  value: T | null;
  options: T[];
  placeholder: string;
  onChange: (value: T | null) => void;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  getLabel: (item: T) => string;
  getValue: (item: T) => string;
}) {
  return (
    <div className="relative">
      <label htmlFor={name} className="block text-sm text-muted mb-1.5">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      <div className="relative">
        <select
          id={name}
          name={name}
          value={value ? getValue(value) : ""}
          onChange={(e) => {
            const selectedValue = e.target.value;
            if (!selectedValue) {
              onChange(null);
              return;
            }
            const found = options.find(opt => getValue(opt) === selectedValue);
            onChange(found ?? null);
          }}
          disabled={disabled}
          required={required}
          className="w-full appearance-none pr-10 pl-4 py-2.5 rounded-lg border border-line bg-background text-sm text-foreground transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="" disabled>{placeholder}</option>
          {options.map((opt) => (
            <option key={getValue(opt)} value={getValue(opt)}>
              {getLabel(opt)}
            </option>
          ))}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted" />
          )}
        </div>
      </div>
    </div>
  );
}