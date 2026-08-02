/**
 * Geographic helpers shared by the dashboard UI and the server-side push
 * routes. Kept dependency-free so it can run in both environments.
 */

/** Great-circle distance in kilometres (Haversine). */
export function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Bounding box around a point, used to prefilter rows in SQL before the exact
 * Haversine pass. Deliberately generous — it over-selects slightly rather than
 * risking a miss near the poles/edges, and the caller filters precisely after.
 */
export function boundingBox(
  lat: number,
  lng: number,
  km: number
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const latDelta = km / 111; // ~111 km per degree of latitude
  // Degrees of longitude shrink with latitude; clamp the cosine so a point near
  // a pole cannot produce a divide-by-~0 and an infinite box.
  const lngDelta = km / Math.max(1, 111 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

/**
 * Round a coordinate to ~1.1 km precision (2 decimal places).
 *
 * Subscriber locations are stored coarsely on purpose: a 25 km alert radius
 * does not need street-level accuracy, and storing exact coordinates of every
 * person who enables alerts would create a needless tracking database.
 */
export function roundCoarse(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Human-friendly distance for notification copy: "800 m" / "3.2 km". */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
