import { NextResponse } from "next/server";
import { getAdminClient, isPushConfigured } from "@/lib/push";
import { roundCoarse } from "@/lib/geo";
import { nearestDistrict } from "@/lib/districts";

export const dynamic = "force-dynamic";

/**
 * Register a device for proximity alerts.
 *
 * The client sends its precise coordinates; this route rounds them to ~1.1km
 * BEFORE they ever touch the database. Nothing identifying is stored — no
 * name, no phone, just an opaque push endpoint and a coarse area.
 */
export async function POST(request: Request) {
  if (!isPushConfigured()) {
    return NextResponse.json(
      { success: false, error: "Push notifications are not configured on this deployment." },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    endpoint,
    keys,
    lat,
    lng,
    radiusKm,
    wantsSos,
    wantsAlerts,
  } = (body ?? {}) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    lat?: number;
    lng?: number;
    radiusKm?: number;
    wantsSos?: boolean;
    wantsAlerts?: boolean;
  };

  if (!endpoint || typeof endpoint !== "string" || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json(
      { success: false, error: "A push subscription with endpoint and keys is required." },
      { status: 400 }
    );
  }

  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return NextResponse.json(
      { success: false, error: "A location is required to send alerts near you." },
      { status: 400 }
    );
  }

  // Mirrors the DB CHECK constraint — reject outside Kerala with a clear
  // message instead of surfacing a raw constraint violation.
  if (lat < 8.0 || lat > 13.0 || lng < 74.5 || lng > 77.6) {
    return NextResponse.json(
      { success: false, error: "Alerts are only available for locations within Kerala." },
      { status: 400 }
    );
  }

  const coarseLat = roundCoarse(lat);
  const coarseLng = roundCoarse(lng);
  const radius = Math.min(100, Math.max(1, Math.round(radiusKm ?? 25)));

  try {
    const { error } = await getAdminClient()
      .from("push_subscriptions")
      .upsert(
        {
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          lat: coarseLat,
          lng: coarseLng,
          radius_km: radius,
          district: nearestDistrict(coarseLat, coarseLng),
          wants_sos: wantsSos !== false,
          wants_alerts: wantsAlerts !== false,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      );

    if (error) {
      console.error("Push subscribe failed:", error.message);
      return NextResponse.json(
        { success: false, error: "Could not save your alert settings." },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Push subscribe error:", err);
    return NextResponse.json(
      { success: false, error: "Could not save your alert settings." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, radiusKm: radius });
}
