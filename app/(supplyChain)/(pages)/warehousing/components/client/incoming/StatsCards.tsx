"use client";

interface StatsCardsProps {
    scanned: number;
    topCourier: string;
}

export function StatsCards({ scanned, topCourier }: StatsCardsProps) {
    return (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 self-center w-full">
            {/* Scanned Card */}
            <div className="bg-[#ebf0f7] dark:bg-[#12131d] border border-white/90 dark:border-white/[0.06] shadow-[inset_2px_2px_5px_rgba(166,175,195,0.35),inset_-2px_-2px_5px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.6)] rounded-2xl transition-all p-3.5 sm:p-4 text-center flex flex-col items-center justify-center relative overflow-hidden group">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Scanned
                </span>
                <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight mt-1 font-mono">
                    {scanned ?? 0}
                </div>
                <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mt-1 flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-pink-100 dark:bg-pink-950/50 flex items-center justify-center text-pink-600 dark:text-pink-400">
                        <i className="fas fa-barcode text-[8px]" />
                    </span>
                    <span>total processed</span>
                </div>
            </div>

            {/* Top Courier Card */}
            <div className="bg-[#ebf0f7] dark:bg-[#12131d] border border-white/90 dark:border-white/[0.06] shadow-[inset_2px_2px_5px_rgba(166,175,195,0.35),inset_-2px_-2px_5px_rgba(255,255,255,0.9)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.6)] rounded-2xl transition-all p-3.5 sm:p-4 text-center flex flex-col items-center justify-center relative overflow-hidden group">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Top Courier
                </span>
                <div
                    className="text-lg sm:text-xl font-black text-pink-600 dark:text-pink-400 tracking-tight mt-1 truncate max-w-full px-1"
                    title={topCourier || "N/A"}
                >
                    {topCourier || "—"}
                </div>
                <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mt-1 flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-pink-100 dark:bg-pink-950/50 flex items-center justify-center text-pink-600 dark:text-pink-400">
                        <i className="fas fa-truck text-[8px]" />
                    </span>
                    <span>highest volume</span>
                </div>
            </div>
        </div>
    );
}