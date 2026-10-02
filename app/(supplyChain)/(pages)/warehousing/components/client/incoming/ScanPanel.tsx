"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../../../../lib/services/client/supabase";
import ScanInput from "./ScanInput";
import { ScanSummary } from "./ScanSummary";
import { StatsCards } from "./StatsCards";

interface ScanPanelProps {
    scanned: number;
    topCourier: string;
    onScan?: (barcode?: string, isOffline?: boolean) => void;
}

export default function ScanPanel({ scanned, topCourier, onScan }: ScanPanelProps) {
    const [lastScan, setLastScan] = useState<string>("");
    const [lastScanStatus, setLastScanStatus] = useState<string>("");
    const [isListening, setIsListening] = useState(true);

    const fetchLastScan = async () => {
        try {
            const { data, error } = await supabase
                .from('receiving_queue')
                .select('barcode, status')
                .order('scanned_at', { ascending: false })
                .limit(1);

            if (error) throw error;

            if (data && data.length > 0) {
                setLastScan(data[0].barcode);
                setLastScanStatus(data[0].status);
            } else {
                setLastScan("No scans yet");
                setLastScanStatus("");
            }
        } catch (error) {
            console.error('Error fetching last scan:', error);
            setLastScan("Error loading");
            setLastScanStatus("");
        }
    };

    useEffect(() => {
        fetchLastScan();
    }, []);

    const handleScan = (barcode?: string, isOffline?: boolean) => {
        if (barcode) {
            setLastScan(barcode);
            setLastScanStatus(isOffline ? "not_synced" : "pending");
        } else {
            fetchLastScan();
        }
        onScan?.(barcode, isOffline);
    };

    const handleStartListening = () => {
        setIsListening(true);
    };

    const handleStopListening = () => {
        setIsListening(false);
    };

    return (
        <div className="bg-[#f0f3f8] dark:bg-[#151622] rounded-3xl border border-white/80 dark:border-white/[0.06] shadow-[4px_4px_12px_rgba(166,175,195,0.35),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_14px_rgba(0,0,0,0.6),-2px_-2px_8px_rgba(255,255,255,0.02)] p-5 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6 transition-all">
            <div className="md:col-span-2 flex flex-col justify-between">
                <div>
                    <ScanInput
                        onScan={handleScan}
                        isListening={isListening}
                        onStartListening={handleStartListening}
                        onStopListening={handleStopListening}
                        totalScanned={scanned}
                    />
                </div>
                <ScanSummary lastScan={lastScan} lastScanStatus={lastScanStatus} />
            </div>
            <StatsCards scanned={scanned} topCourier={topCourier} />
        </div>
    );
}