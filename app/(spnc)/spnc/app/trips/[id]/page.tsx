"use client";

// Trip details page: /spnc/app/trips/<trip id>
// Opened from the Schedules calendar (eye icon), also for trips with no schedule linked.

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import DocumentLogo from "../../../components/DocumentLogo";
import TripDetailCard, { type Trip } from "../../../components/TripDetailCard";
import TripTrackingModal from "../../../components/TripTrackingModal";

type LinkedSchedule = {
  id: string;
  schedule_code: string;
  departure_datetime: string;
  arrival_datetime: string;
  notes?: string | null;
  routes?: { route_name?: string | null; route_code?: string | null; origin?: string | null; destination?: string | null } | null;
};

export default function TripDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [schedule, setSchedule] = useState<LinkedSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [tracking, setTracking] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/spnc/app/api/trips", { cache: "no-store" });
        if (!res.ok) throw new Error(`Trips request failed (${res.status})`);
        const data = await res.json();
        const list: Trip[] = Array.isArray(data.trips) ? data.trips : [];
        const found = list.find((t) => String(t.id) === String(params.id)) ?? null;
        setTrip(found);

        // If the trip runs on a schedule, use it for the planned departure / arrival times
        if (found?.schedule_id) {
          const sRes = await fetch(`/spnc/app/api/schedules/${found.schedule_id}`, { cache: "no-store" }).catch(() => null);
          if (sRes && sRes.ok) {
            const s = await sRes.json().catch(() => ({}));
            setSchedule(s.schedule ?? null);
          }
        }
      } catch (error) {
        console.error("Fetch trip failed:", error);
      } finally {
        setLoading(false);
      }
    }
    if (params.id) load();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white">
        <Loader2 size={32} className="animate-spin text-[#F2419B]" />
        <p className="text-sm font-semibold text-[#F2419B]">Loading</p>
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white">
        <p className="text-sm text-gray-500">Trip not found.</p>
        <button onClick={() => router.push("/spnc/app/schedules")} className="text-sm text-[#F2419B] hover:underline">
          Back to Schedules
        </button>
      </div>
    );
  }

  // Title: where the trip started → where it ended (or is going)
  const cps = [...(trip.checkpoints || [])].sort((a, b) => a.checkpoint_no - b.checkpoint_no);
  const start = schedule?.routes?.origin || cps[0]?.location;
  const delivered = cps.find((c) => ["delivered", "completed"].includes(c.status));
  const end = schedule?.routes?.destination || delivered?.location || (cps.length > 1 ? cps[cps.length - 1].location : null);
  const title = start && end ? `${start} → ${end}` : start || trip.trip_code;

  return (
    <div className="min-h-screen bg-white px-8 py-10">
      <div className="print-hidden mb-8 flex items-center justify-between">
        <button type="button" onClick={() => router.push("/spnc/app/schedules")} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft size={16} />
          Back to Schedules
        </button>
        <button type="button" onClick={() => window.print()} className="flex items-center gap-2 rounded-md bg-[#F2419B] px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[#D9297E]">
          <Printer size={18} />
          Print
        </button>
      </div>

      <div className="mx-auto max-w-3xl">
        <DocumentLogo />
        <h1 className="mt-2 text-3xl font-bold text-gray-900">{title}</h1>
        <p className="mt-2 text-sm text-gray-500">
          Trip · {trip.trip_code}
          {schedule ? ` · Schedule ${schedule.schedule_code}` : " · No schedule linked"}
        </p>
        <div className="mt-4 h-1 w-full bg-[#F2419B]" />

        <div className="mt-8">
          <TripDetailCard
            trip={trip}
            plannedDeparture={schedule?.departure_datetime}
            plannedArrival={schedule?.arrival_datetime}
            destination={schedule?.routes?.destination}
            onTrack={() => setTracking(true)}
          />
        </div>

        {schedule?.notes && (
          <div className="mt-8">
            <p className="border-b border-gray-200 pb-2 text-sm font-bold tracking-wide text-gray-900 uppercase">Notes</p>
            <p className="mt-4 text-sm leading-relaxed text-gray-800">{schedule.notes}</p>
          </div>
        )}

        <div className="mt-16 flex items-center justify-between border-t border-gray-200 pt-3 text-xs text-gray-400">
          <span>{trip.trip_code}</span>
          <span>Airship Express</span>
        </div>
      </div>

      {tracking && <TripTrackingModal tripId={trip.id} isDark={false} onClose={() => setTracking(false)} />}
    </div>
  );
}
