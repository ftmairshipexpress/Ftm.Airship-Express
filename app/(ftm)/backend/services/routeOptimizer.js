/** Local Python OR-Tools adapter retained for the legacy trip optimization hooks. */

const { spawn } = require('child_process');
const path = require('path');
const { getServiceSupabase } = require('../config/db');

const PYTHON_TIMEOUT_MS = 25000;
/**
 * Runs the shared Python OR-Tools solver. Python errors are surfaced to the
          const { error: tripUpdateError } = await supabase
            .from('trips')
            .update({ optimized_route_id: insertData.id })
            .eq('id', tripId);
          if (tripUpdateError) {
            console.warn('[routeOptimizer] Failed to link optimized route to trip:', tripUpdateError.message || tripUpdateError);
          }
        }
      }
    }
  } catch (persistErr) {
    console.warn('[routeOptimizer] Exception while persisting optimized route:', persistErr.message || persistErr);
  }

  return result;
}

/**
 * Automatically optimizes the route for a single trip's pickup -> dropoff
 * (and any other stops already queued for the same vehicle) the instant the
 * trip is dispatched. No dispatcher action required. Safe to call
 * fire-and-forget; failures are logged, never thrown back at the caller.
 */
async function autoOptimizeForTrip(trip) {
  try {
    const supabase = getServiceSupabase();
    if (!supabase || !trip?.vehicle_id) return null;

    // Pull every other active (not yet completed/cancelled) trip assigned to
    // the same vehicle so the optimizer plans the whole run, not just this
    // one stop in isolation.
    const { data: vehicleTrips, error } = await supabase
      .from('trips')
      .select(`id, status, bookings(pickup_location, pickup_latitude, pickup_longitude, dropoff_location, dropoff_latitude, dropoff_longitude, cargo_weight)`)
      .eq('vehicle_id', trip.vehicle_id)
      .not('status', 'in', '("Completed","Cancelled")');

    if (error) {
      console.warn('[routeOptimizer] Could not load vehicle trip queue for auto-optimization:', error.message);
      return null;
    }

    const source = (vehicleTrips && vehicleTrips.length > 0) ? vehicleTrips : [trip];
    const stops = [];
    let depot = null;

    source.forEach((t) => {
      const booking = Array.isArray(t.bookings) ? t.bookings[0] : t.bookings;
      if (!booking) return;
      if (!depot && booking.pickup_latitude != null && booking.pickup_longitude != null) {
        depot = { name: booking.pickup_location || 'Depot', lat: Number(booking.pickup_latitude), lng: Number(booking.pickup_longitude) };
      }
      if (booking.dropoff_latitude != null && booking.dropoff_longitude != null) {
        stops.push({
          name: booking.dropoff_location || `Stop ${stops.length + 1}`,
          lat: Number(booking.dropoff_latitude),
          lng: Number(booking.dropoff_longitude),
          demand: Math.max(0, Math.round(Number(booking.cargo_weight) || 0)),
        });
      }
    });

    if (!depot || stops.length === 0) return null;

    const result = await optimizeAndPersist({ depot, stops, tripId: trip.id, numVehicles: 1 });
    console.log(`[routeOptimizer] Auto-optimized route for trip ${trip.id} (${stops.length} stop(s), ${result.used_ortools ? 'OR-Tools' : 'fallback heuristic'}).`);
    return result;
  } catch (err) {
    console.warn('[routeOptimizer] Automatic optimization failed:', err.message || err);
    return null;
  }
}

module.exports = { runOptimizer, optimizeAndPersist, autoOptimizeForTrip };
