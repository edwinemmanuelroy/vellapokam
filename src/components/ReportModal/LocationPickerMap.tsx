"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import {
  TILE_URL,
  TILE_ATTRIBUTION,
  TILE_MIN_ZOOM,
  TILE_MAX_ZOOM,
} from "@/lib/mapConfig";

interface LocationPickerMapProps {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
}

const DEFAULT_CENTER: [number, number] = [10.8505, 76.2711]; // Kerala center

function pickerIcon(): L.DivIcon {
  return L.divIcon({
    className: "picker-marker",
    iconSize: [32, 42],
    iconAnchor: [16, 42],
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
        <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 26 16 26s16-14 16-26C32 7.163 24.837 0 16 0z"
              fill="#ef4444" stroke="#ffffff" stroke-width="2"/>
        <circle cx="16" cy="16" r="6" fill="white"/>
        <circle cx="16" cy="16" r="3" fill="#ef4444"/>
      </svg>
    `,
  });
}

function MapClickHandler({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/**
 * `MapContainer`'s `center`/`zoom` props are only read on mount, so a GPS fix
 * that arrives after the picker has rendered would move the pin off-screen
 * while the viewport stayed on the Kerala overview. This pans the map to follow
 * the coordinates — but only when they change externally, so a user dragging
 * the pin or clicking the map is never yanked around mid-gesture.
 *
 * Only coordinates outside the current viewport trigger a move, so tapping a
 * spot on the visible map leaves the view exactly where the user put it.
 */
function RecenterOnCoords({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  const hasCentered = useRef(false);

  useEffect(() => {
    if (lat === null || lng === null) return;
    if (hasCentered.current && map.getBounds().contains([lat, lng])) return;

    // First real fix zooms in; later off-screen corrections just pan.
    const zoom = hasCentered.current ? map.getZoom() : 15;
    hasCentered.current = true;
    map.setView([lat, lng], zoom, { animate: true });
  }, [lat, lng, map]);

  return null;
}

export default function LocationPickerMap({ lat, lng, onChange }: LocationPickerMapProps) {
  const position: [number, number] = lat !== null && lng !== null ? [lat, lng] : DEFAULT_CENTER;

  // Rebuilding the DivIcon every render makes Leaflet tear down and re-add the
  // marker, which cancels an in-progress drag.
  const icon = useMemo(() => pickerIcon(), []);

  const eventHandlers = useMemo(
    () => ({
      dragend(e: L.DragEndEvent) {
        const marker = e.target;
        if (marker != null) {
          const newLatLng = marker.getLatLng();
          onChange(newLatLng.lat, newLatLng.lng);
        }
      },
    }),
    [onChange]
  );

  return (
    <div className="relative h-44 w-full overflow-hidden rounded-xl border border-surface-700 bg-surface-950">
      <MapContainer
        center={position}
        zoom={lat !== null ? 14 : 9}
        minZoom={TILE_MIN_ZOOM}
        maxZoom={TILE_MAX_ZOOM}
        scrollWheelZoom={true}
        className="h-full w-full"
        style={{ background: "#dee2e6" }}
      >
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={TILE_URL}
          updateWhenIdle={true}
        />
        <MapClickHandler onChange={onChange} />
        <RecenterOnCoords lat={lat} lng={lng} />
        {lat !== null && lng !== null && (
          <Marker
            position={position}
            draggable={true}
            eventHandlers={eventHandlers}
            icon={icon}
          />
        )}
      </MapContainer>
      <div className="absolute bottom-2 left-2 right-2 z-[1000] flex items-center justify-between rounded-sm border border-surface-800 bg-surface-950/90 px-2 py-1 text-[10px] font-semibold text-surface-400">
        <span>Click map or drag pin to fine-tune location</span>
        {lat !== null && (
          <span className="font-mono text-surface-100">
            {lat.toFixed(5)}, {lng?.toFixed(5)}
          </span>
        )}
      </div>
    </div>
  );
}
