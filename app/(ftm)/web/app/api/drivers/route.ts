import { NextResponse } from "next/server";
import { hasPermission } from "../../lib/permissions";
import { authenticateFtmRequest } from "../../lib/server/ftmRequestAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  const { context } = auth;
  if (!hasPermission(context.user.role, "driverPerformance", "view")) {
    return NextResponse.json({ error: "Permission denied: driverPerformance.view" }, { status: 403 });
  }

  try {
    const { data: queriedDrivers, error } = await context.serviceClient
      .from("users")
      .select("id, email, full_name, role, is_active, courier_id, created_at, updated_at")
      .eq("role", "driver")
      .order("full_name", { ascending: true });
    if (error || !queriedDrivers?.length) return NextResponse.json([]);

    const courierId = new URL(request.url).searchParams.get("courier_id");
    const filteredDrivers = courierId
      ? queriedDrivers.filter((driver) => String(driver.courier_id) === courierId)
      : queriedDrivers;
    if (!filteredDrivers.length) return NextResponse.json([]);

    const courierIds = [...new Set(filteredDrivers.map((driver) => driver.courier_id).filter(Boolean))];
    const { data: couriers } = courierIds.length
      ? await context.serviceClient.from("couriers").select("id, name, code").in("id", courierIds)
      : { data: [] };
    const courierNames = new Map((couriers || []).map((courier) => [String(courier.id), courier.name]));

    const enriched = await Promise.all(filteredDrivers.map(async (driver) => {
      const result: Record<string, unknown> = {
        ...driver,
        status: driver.is_active === false ? "Inactive" : "Available",
        courier: courierNames.get(String(driver.courier_id)) || null,
      };
      try {
        const { data: assignments, error: assignmentError } = await context.serviceClient
          .from("driver_assignments")
          .select("vehicle_id")
          .eq("driver_id", driver.id)
          .limit(1);
        if (!assignmentError && assignments?.[0]?.vehicle_id) result.vehicle_id = assignments[0].vehicle_id;
      } catch {
        // Assignment enrichment is optional for older FTM schemas.
      }

      try {
        const { data: location, error: locationError } = await context.serviceClient
          .from("mobile_device_tracking")
          .select("lat, lng, recorded_at")
          .eq("driver_id", driver.id)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!locationError && location) {
          result.last_location_lat = location.lat;
          result.last_location_lng = location.lng;
          result.last_location_at = location.recorded_at;
          return result;
        }
        const fallback = await context.serviceClient
          .from("driver_tracking")
          .select("latitude, longitude, recorded_at")
          .eq("driver_id", driver.id)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!fallback.error && fallback.data) {
          result.last_location_lat = fallback.data.latitude;
          result.last_location_lng = fallback.data.longitude;
          result.last_location_at = fallback.data.recorded_at;
        }
      } catch {
        // Location history is optional for older FTM schemas.
      }
      return result;
    }));
    return NextResponse.json(enriched);
  } catch (error) {
    console.warn("Driver list error:", error);
    return NextResponse.json([]);
  }
}