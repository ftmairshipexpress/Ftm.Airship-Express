"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Map } from "lucide-react";
import { useShell } from "../../../components/ShellContext";
import PageHeader from "../../../components/PageHeader";
import { MOCK_ROUTES, createInitialTransfers, getRoute } from "../monitor/mock-transfers";

// Sample data lang ito. Walang fetch, walang Supabase, kaya walang 500 error.
// Kapag ang id ay hindi tugma sa sample routes (halimbawa UUID mula sa database), gagamitin ang unang sample route.

function statusClass(status: string, isDark: boolean) {
  switch (status) {
    case "completed":
      return isDark ? "bg-[#0F2E22] text-[#3BD68A]" : "bg-[#E1F7EC] text-[#1FA968]";
    case "in_transit":
      return isDark ? "bg-[#12203A] text-[#5B8CF2]" : "bg-[#E5EEFD] text-[#3B6FE0]";
    case "delayed":
      return isDark ? "bg-[#33260C] text-[#E5A93C]" : "bg-[#FDF0D5] text-[#B7791F]";
    case "rerouted":
      return isDark ? "bg-[#3A1229] text-[#F2419B]" : "bg-[#FCE4F1] text-[#D9297E]";
    case "failed":
    case "disrupted":
      return isDark ? "bg-[#2A1212] text-[#E2685A]" : "bg-[#FBE4E1] text-[#D9483A]";
    default:
      return isDark ? "bg-[#23303D] text-[#8FA0AF]" : "bg-gray-100 text-gray-500";
  }
}

export default function RouteDetailPage() {
  const { theme } = useShell();
  const isDark = theme === "dark";
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const matched = MOCK_ROUTES.find((r) => r.id === params?.id);
  const route = matched ?? MOCK_ROUTES[0];
  const isFallbackSample = !matched;

  // Ang chain ng fallback: r1 -> r2 -> r3
  const chain = [route];
  while (chain[chain.length - 1].fallback_route_id) {
    chain.push(getRoute(chain[chain.length - 1].fallback_route_id!));
  }

  const transfers = createInitialTransfers().filter((t) => t.legs.some((l) => l.routeId === route.id));

  const mutedText = isDark ? "text-[#8FA0AF]" : "text-gray-500";
  const bodyText = isDark ? "text-[#C7D1DA]" : "text-gray-700";
  const card = `rounded-lg border p-4 ${isDark ? "border-[#23303D] bg-[#121B26]" : "border-gray-200 bg-white"}`;

  return (
    <div className={`min-h-full pb-24 ${isDark ? "bg-[#0B1220]" : "bg-white"}`}>
      <PageHeader icon={<Map size={20} />} title={route.route_code} subtitle={route.route_name} />

      <div className="space-y-6 px-8">
        <button
          type="button"
          onClick={() => router.push("/spnc/app/routes")}
          className={`flex items-center gap-2 text-sm font-medium ${mutedText} hover:text-[#F2419B]`}
        >
          <ArrowLeft size={15} /> Bumalik sa routes
        </button>

        {isFallbackSample && (
          <p className={`rounded-md border border-dashed px-3 py-2 text-xs ${isDark ? "border-[#2C4356]" : "border-gray-300"} ${mutedText}`}>
            Sample data ang ipinapakita. Wala pang tugma sa route na ito sa mock list.
          </p>
        )}

        <section className={card}>
          <dl className={`grid gap-4 text-sm sm:grid-cols-3 ${bodyText}`}>
            <div>
              <dt className={`text-xs ${mutedText}`}>Origin</dt>
              <dd className="font-medium">{route.origin}</dd>
            </div>
            <div>
              <dt className={`text-xs ${mutedText}`}>Transit points</dt>
              <dd className="font-medium">{route.transit_points.join(", ") || "Wala"}</dd>
            </div>
            <div>
              <dt className={`text-xs ${mutedText}`}>Destination</dt>
              <dd className="font-medium">{route.destination}</dd>
            </div>
          </dl>
        </section>

        <section className={card}>
          <h3 className={`mb-3 text-sm font-semibold ${isDark ? "text-[#F2F1EC]" : "text-gray-900"}`}>
            Landas kapag may pumalya
          </h3>
          <div className={`flex flex-wrap items-center gap-2 text-sm ${bodyText}`}>
            {chain.map((r, i) => (
              <div key={r.id} className="flex items-center gap-2">
                <span className="rounded-md border border-[#F2419B]/40 px-3 py-1.5 font-semibold text-[#F2419B]">{r.route_code}</span>
                {i < chain.length - 1 && <span className={`text-xs ${mutedText}`}>kung pumalya, lipat sa</span>}
              </div>
            ))}
            <span className={`text-xs ${mutedText}`}>{chain[chain.length - 1].fallback_route_id ? "" : "wala nang susunod: manual na aksyon"}</span>
          </div>
        </section>

        <section className={card}>
          <h3 className={`mb-3 text-sm font-semibold ${isDark ? "text-[#F2F1EC]" : "text-gray-900"}`}>
            Mga transfer sa route na ito
          </h3>
          {transfers.length === 0 ? (
            <p className={`text-sm ${mutedText}`}>Wala pang transfer.</p>
          ) : (
            <ul className="space-y-4">
              {transfers.map((t) => (
                <li key={t.id} className={`text-sm ${bodyText}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span>
                      <span className="font-semibold text-[#F2419B]">{t.reference_no}</span> · {t.dataset}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(t.status, isDark)}`}>{t.status}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {t.legs.map((l) => (
                      <span key={l.id} className={`rounded-md border px-2.5 py-1 text-xs ${isDark ? "border-[#2C4356]" : "border-gray-200"}`}>
                        {l.from} → {l.to}{" "}
                        <span className={`ml-1 rounded-full px-1.5 py-0.5 ${statusClass(l.status, isDark)}`}>{l.status}</span>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
