/**
 * Basemap tile configuration, shared by the main map and the location picker.
 *
 * Defaults to OpenStreetMap's standard tile server, used per the OSMF Tile
 * Usage Policy:
 *   - attribution to OpenStreetMap is mandatory and must stay visible;
 *   - no `{s}` subdomains (deprecated — one domain, CDN-fronted) and no `{r}`
 *     retina suffix (OSM serves no @2x tiles; requesting them 4x-es load);
 *   - the app must not hard-require tile.openstreetmap.org, hence the env
 *     override below — swap providers with a config change, no deploy.
 *
 * Override for a keyed provider (MapTiler, Stadia, self-hosted) by setting
 * NEXT_PUBLIC_MAP_TILE_URL and NEXT_PUBLIC_MAP_ATTRIBUTION.
 */

export const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ||
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** OSM standard tiles top out at z19; stay a step below to be gentle. */
export const TILE_MAX_ZOOM = 18;

/** Kerala is a state-level view — below z7 users are just loading the ocean. */
export const TILE_MIN_ZOOM = 7;

/**
 * Kerala bounding box with margin, used as maxBounds on the main map so pans
 * cannot wander (and request tiles) across the subcontinent.
 * [[south, west], [north, east]]
 */
export const KERALA_BOUNDS: [[number, number], [number, number]] = [
  [7.5, 73.5],
  [13.5, 78.5],
];
