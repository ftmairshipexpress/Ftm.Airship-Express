"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import DocumentLogo from "../../../components/DocumentLogo";
import TripDetailCard, { type Trip } from "../../../components/TripDetailCard";
import TripTrackingModal from "../../../components/TripTrackingModal";

type Schedule = {
  id: string;
  schedule_code: string;
  departure_datetime: string;
  arrival_datetime: string;
  frequency?: string | null;
  day_of_week?: string | null;
  capacity?: number | null;
  unit_type?: string | null;
  cutoff_hours?: number | null;
  status?: string | null;
  notes?: string | null;
  routes?: {
    route_code?: string | null;
    route_name?: string | null;
    origin?: string | null;
    destination?: string | null;
    mode_of_transport?: string | null;
    transit_points?: string[] | null;
  } | null;
  service_providers?: { name?: string | null; type?: string | null; contact_person?: string | null; phone?: string | null; email?: string | null } | null;
};

export default function ScheduleDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackingId, setTrackingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [sRes, tRes] = await Promise.all([
          fetch(`/spnc/app/api/schedules/${params.id}`, { cache: "no-store" }),
          fetch(`/spnc/app/api/trips`, { cache: "no-store" }).catch(() => null),
        ]);
        const contentType = sRes.headers.get("content-type") || "";
        if (!sRes.ok || !contentType.includes("application/json")) throw new Error(`Schedule request failed (${sRes.status})`);
        const data = await sRes.json();
        setSchedule(data.schedule || null);

        // Trips that run on this schedule (optional: the page still works without them)
        if (tRes && tRes.ok) {
          const t = await tRes.json().catch(() => ({}));
          const list: Trip[] = Array.isArray(t.trips) ? t.trips : [];
          setTrips(list.filter((x) => String(x.schedule_id ?? "") === String(params.id)));
        }
      } catch (error) {
        console.error("Fetch schedule failed:", error);
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

  if (!schedule) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white">
        <p className="text-sm text-gray-500">Schedule not found.</p>
        <button onClick={() => router.push("/spnc/app/schedules")} className="text-sm text-[#F2419B] hover:underline">
          Back to Schedules
        </button>
      </div>
    );
  }

  const route = schedule.routes;
  // Page title: the route name; with no route linked, use where the trip started → where it's going
  const firstTripStart = [...(trips[0]?.checkpoints || [])].sort((a, b) => a.checkpoint_no - b.checkpoint_no)[0]?.location;
  const routeLabel =
    route?.route_name ||
    route?.route_code ||
    (route?.origin && route?.destination ? `${route.origin} → ${route.destination}` : null) ||
    (firstTripStart ? `${firstTripStart}${route?.destination ? ` → ${route.destination}` : ""}` : null) ||
    schedule.schedule_code;

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
        <h1 className="mt-2 text-3xl font-bold text-gray-900">{routeLabel}</h1>
        <p className="mt-2 text-sm text-gray-500">
          Schedule · {schedule.schedule_code}
          {route?.route_code && route?.route_name ? ` · ${route.route_code}` : ""}
        </p>
        <div className="mt-4 h-1 w-full bg-[#F2419B]" />

        {/* Trips on this schedule */}
        <div className="mt-8">
          <p className="border-b border-gray-200 pb-2 text-sm font-bold tracking-wide text-gray-900 uppercase">
            Trips {trips.length > 0 && <span className="font-normal text-gray-400">({trips.length})</span>}
          </p>

          {trips.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No trips linked to this schedule yet.</p>
          ) : (
            <div className="mt-4 space-y-5">
              {trips.map((t) => (
                <TripDetailCard
                  key={t.id}
                  trip={t}
                  plannedDeparture={schedule.departure_datetime}
                  plannedArrival={schedule.arrival_datetime}
                  destination={route?.destination}
                  onTrack={setTrackingId}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-8">
          <p className="border-b border-gray-200 pb-2 text-sm font-bold tracking-wide text-gray-900 uppercase">Notes</p>
          <p className="mt-4 text-sm leading-relaxed text-gray-800">{schedule.notes || "No notes added."}</p>
        </div>

        <div className="mt-16 flex items-center justify-between border-t border-gray-200 pt-3 text-xs text-gray-400">
          <span>{schedule.schedule_code}</span>
          <span>Airship Express</span>
        </div>
      </div>

      {trackingId && <TripTrackingModal tripId={trackingId} isDark={false} onClose={() => setTrackingId(null)} />}
    </div>
  );
}
