"use client";

import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";

export type LatLng = [number, number];

export type MapCheckpoint = {
  no: number;
  coords: LatLng;
  label: string;
  status: string;
};

type Props = {
  isDark: boolean;
  travelled: LatLng[];
  remaining: LatLng[];
  start: LatLng | null;
  current: LatLng | null;
  destination: LatLng | null;
  checkpoints: MapCheckpoint[];
  pinLabel: string;
  finished: boolean;
  /** Change this number to re-fit the map to the route (the "recenter" button). */
  fitKey: number;
};

const ROUTE_COLOR = "#F2856B"; // salmon, like the courier-app route line
const PIN_COLOR = "#EE4D2D";

// Free OpenStreetMap tiles, no API key needed.
// To use another provider (MapTiler, Stadia, Mapbox…), set NEXT_PUBLIC_MAP_TILE_URL,
// e.g. https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

function makeTiles(L: typeof Leaflet) {
  return L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 });
}

const pinSvg = (color: string) => `
  <svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="17" cy="41" rx="6" ry="2.5" fill="rgba(0,0,0,.25)"/>
    <path d="M17 1C8.7 1 2 7.6 2 15.8 2 27 17 40 17 40s15-13 15-24.2C32 7.6 25.3 1 17 1z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="17" cy="15.5" r="5.5" fill="#fff"/>
  </svg>`;

const truckSvg = `
  <div style="width:34px;height:34px;border-radius:50%;background:#fff;border:3px solid ${PIN_COLOR};
              display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.3)">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${PIN_COLOR}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/>
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 8.38A1 1 0 0 0 17.52 8H14"/>
      <circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>
    </svg>
  </div>`;

export default function TripTrackingMap(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const tileRef = useRef<Leaflet.TileLayer | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const boundsRef = useRef<Leaflet.LatLngBounds | null>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props; // runs before the effects below, so draw() always sees fresh props
  });

  /* ---------- create the map once (Leaflet needs `window`, so load it here) ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import("leaflet");
      const L = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as unknown as typeof Leaflet);
      if (cancelled || !containerRef.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
        center: [14.676, 121.0437], // Quezon City until the route loads
        zoom: 12,
      });
      L.control.zoom({ position: "bottomleft" }).addTo(map);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      draw();
      // The map often mounts inside an animating modal; re-measure once it settles.
      setTimeout(() => map.invalidateSize(), 250);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      tileRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- tiles follow the theme ---------- */
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    tileRef.current?.remove();
    tileRef.current = makeTiles(L).addTo(map);
  }, [props.isDark]);

  /* ---------- redraw route & markers when data changes ---------- */
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.travelled, props.remaining, props.start, props.current, props.destination, props.checkpoints, props.pinLabel, props.finished]);

  /* ---------- recenter ---------- */
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitKey]);

  function fit() {
    const map = mapRef.current;
    const b = boundsRef.current;
    if (!map) return;
    if (b && b.isValid()) {
      if (b.getNorthEast().equals(b.getSouthWest())) map.setView(b.getCenter(), 15);
      else map.fitBounds(b, { padding: [48, 48], maxZoom: 16 });
    }
  }

  function draw() {
    const L = LRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    const p = propsRef.current;

    if (!tileRef.current) {
      tileRef.current = makeTiles(L).addTo(map);
    }

    layer.clearLayers();
    const bounds = L.latLngBounds([]);

    // Remaining leg (planned): dashed grey
    if (p.remaining.length >= 2) {
      L.polyline(p.remaining, {
        color: p.isDark ? "#8FA0AF" : "#9CA3AF",
        weight: 4,
        opacity: 0.9,
        dashArray: "2 9",
        lineCap: "round",
      }).addTo(layer);
      p.remaining.forEach((pt) => bounds.extend(pt));
    }

    // Travelled leg: solid salmon with a soft halo
    if (p.travelled.length >= 2) {
      L.polyline(p.travelled, { color: "#fff", weight: 8, opacity: 0.7, lineCap: "round" }).addTo(layer);
      L.polyline(p.travelled, { color: ROUTE_COLOR, weight: 5, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(layer);
      p.travelled.forEach((pt) => bounds.extend(pt));
    }

    // Intermediate checkpoints: small numbered dots
    const endNo = p.checkpoints.length ? p.checkpoints[p.checkpoints.length - 1].no : -1;
    p.checkpoints.forEach((cp, i) => {
      bounds.extend(cp.coords);
      if (i === 0 || cp.no === endNo) return; // start/current drawn separately
      L.marker(cp.coords, {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:18px;height:18px;border-radius:50%;background:#fff;border:2px solid ${ROUTE_COLOR};
                  font:700 9px/14px system-ui;text-align:center;color:${PIN_COLOR}">${cp.no}</div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      })
        .bindTooltip(`#${cp.no} · ${cp.label}`, { direction: "top", offset: [0, -8] })
        .addTo(layer);
    });

    // Start: solid red dot
    if (p.start) {
      bounds.extend(p.start);
      L.circleMarker(p.start, { radius: 7, color: "#fff", weight: 2, fillColor: PIN_COLOR, fillOpacity: 1 })
        .bindTooltip("Start", { direction: "top" })
        .addTo(layer);
    }

    // Destination pin (when still on the way): grey pin
    if (p.destination && !p.finished) {
      bounds.extend(p.destination);
      L.marker(p.destination, {
        icon: L.divIcon({ className: "", html: pinSvg("#6B7280"), iconSize: [34, 44], iconAnchor: [17, 40] }),
      })
        .bindTooltip("Destination", { direction: "top", offset: [0, -36] })
        .addTo(layer);
    }

    // Current position: red pin when delivered, truck while moving; with a permanent label
    const here = p.finished ? p.current ?? p.destination : p.current;
    if (here) {
      bounds.extend(here);
      const icon = p.finished
        ? L.divIcon({ className: "", html: pinSvg(PIN_COLOR), iconSize: [34, 44], iconAnchor: [17, 40] })
        : L.divIcon({ className: "", html: truckSvg, iconSize: [34, 34], iconAnchor: [17, 17] });
      L.marker(here, { icon, zIndexOffset: 1000 })
        .bindTooltip(p.pinLabel, {
          permanent: true,
          direction: "top",
          offset: (p.finished ? [0, -44] : [0, -20]) as [number, number],
          className: "trip-pin-label",
        })
        .addTo(layer);
    }

    const hadBounds = boundsRef.current?.isValid();
    boundsRef.current = bounds;
    if (!hadBounds) fit();
  }

  return (
    <>
      <div ref={containerRef} className={`h-full w-full ${props.isDark ? "trip-map-dark" : ""}`} />
      <style>{`
        .trip-pin-label {
          background: #fff;
          color: ${PIN_COLOR};
          border: none;
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
          font-size: 13px;
          font-weight: 600;
          padding: 6px 12px;
          white-space: nowrap;
        }
        .trip-pin-label::before {
          border-top-color: #fff !important;
        }
        .trip-map-dark .leaflet-tile-pane {
          filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9) saturate(0.6);
        }
        .trip-map-dark.leaflet-container {
          background: #0b1220;
        }
        .leaflet-container {
          font-family: inherit;
        }
      `}</style>
    </>
  );
}
