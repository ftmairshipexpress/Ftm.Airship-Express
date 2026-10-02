"use client";
import { useEffect, useState } from "react";
import AddManualButton from "./AddManualButton";
import { useDebounce } from "../../../../../hooks/useDebounce";
import { sanitizeSearch } from "../../../../../components/global/sanitize";
interface TableFiltersProps {
    onFilterChange?: (courier: string) => void;
    onSearch?: (search: string) => void;
    onAddManual?: () => void;
}
export default function TableFilters({ onSearch, onAddManual }: TableFiltersProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const debouncedSearch = useDebounce(searchTerm, 300);
    useEffect(() => {
        onSearch?.(debouncedSearch);
    }, [debouncedSearch, onSearch]);
    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const sanitized = sanitizeSearch(e.target.value);
        setSearchTerm(sanitized);
    };
    return (<div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={handleSearchChange}
                        className="w-56 bg-[#ebf0f7] dark:bg-[#12131d] border border-white/90 dark:border-white/[0.06] shadow-[inset_1.5px_1.5px_3px_rgba(166,175,195,0.35),inset_-1.5px_-1.5px_3px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.6)] rounded-2xl px-3.5 py-2 pl-9 text-xs font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-pink-500/20 transition-all"
                        placeholder="Search barcode or tracking..."
                        maxLength={100}
                    />
                    <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-xs"></i>
                </div>
            </div>

            <AddManualButton onAdd={onAddManual}/>
        </div>);
}
