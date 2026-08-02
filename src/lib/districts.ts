import { getDistanceKm } from "./geo";

/**
 * Kerala's 14 districts with approximate administrative centres.
 *
 * Single source of truth: the dashboard uses these for filtering and
 * nearest-first sorting, `sachet.ts` matches them against official alert area
 * text, and the push routes use them to target district-scoped alerts.
 */
export interface District {
  name: string;
  lat: number;
  lng: number;
}

export const DISTRICTS: District[] = [
  { name: "Alappuzha", lat: 9.4981, lng: 76.3388 },
  { name: "Ernakulam", lat: 9.9816, lng: 76.2998 },
  { name: "Idukki", lat: 9.8500, lng: 77.1000 },
  { name: "Kannur", lat: 11.8745, lng: 75.3704 },
  { name: "Kasaragod", lat: 12.5103, lng: 74.9852 },
  { name: "Kollam", lat: 8.8932, lng: 76.6141 },
  { name: "Kottayam", lat: 9.5916, lng: 76.5224 },
  { name: "Kozhikode", lat: 11.2588, lng: 75.7804 },
  { name: "Malappuram", lat: 11.0735, lng: 76.0740 },
  { name: "Palakkad", lat: 10.7867, lng: 76.6547 },
  { name: "Pathanamthitta", lat: 9.2648, lng: 76.7870 },
  { name: "Thiruvananthapuram", lat: 8.5241, lng: 76.9366 },
  { name: "Thrissur", lat: 10.5276, lng: 76.2144 },
  { name: "Wayanad", lat: 11.6854, lng: 76.1320 },
];

/** District names only — used for text matching against official alert areas. */
export const DISTRICT_NAMES = DISTRICTS.map((d) => d.name);

/**
 * Nearest district centre to a point. Used to label a push subscriber's area
 * and to route district-scoped official alerts. Returns null for coordinates
 * implausibly far from Kerala (>200 km), so a stray location never gets
 * silently bucketed into a district.
 */
export function nearestDistrict(lat: number, lng: number): string | null {
  let best: string | null = null;
  let bestKm = Infinity;
  for (const d of DISTRICTS) {
    const km = getDistanceKm(lat, lng, d.lat, d.lng);
    if (km < bestKm) {
      bestKm = km;
      best = d.name;
    }
  }
  return bestKm <= 200 ? best : null;
}
