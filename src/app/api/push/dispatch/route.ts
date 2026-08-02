import { NextResponse } from "next/server";
import {
  getAdminClient,
  isPushConfigured,
  secretMatches,
  sendToSubscriptions,
  type PushPayload,
  type PushSubscriptionRow,
} from "@/lib/push";
import { boundingBox, getDistanceKm, formatDistance } from "@/lib/geo";
import { nearestDistrict } from "@/lib/districts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Supabase Database Webhook target: fires on every `sos_requests` INSERT and
 * pushes to opted-in devices within range.
 *
 * Server-triggered on purpose. If the reporter's phone dies or loses signal
 * the moment after their SOS is written, the alert still goes out — which is
 * exactly the scenario this exists for.
 *
 * Configure in Supabase → Database → Webhooks:
 *   table sos_requests · event INSERT · POST https://<host>/api/push/dispatch
 *   header x-webhook-secret: <PUSH_WEBHOOK_SECRET>
 */

/**
 * Only the fields this route is allowed to act on. `name` and `phone` are
 * intentionally absent: they exist on the row but must never reach a
 * notification payload, and leaving them off the type makes that mistake
 * impossible rather than merely discouraged.
 */
interface SosRecord {
  id: string;
  people_count?: number;
  latitude?: number;
  longitude?: number;
  status?: string;
}

export async function POST(request: Request) {
  // Authenticate before doing any work at all.
  if (!secretMatches(request.headers.get("x-webhook-secret"), process.env.PUSH_WEBHOOK_SECRET)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!isPushConfigured()) {
    return NextResponse.json(
      { success: false, error: "Push is not configured on this deployment." },
      { status: 503 }
    );
  }

  let payload: { type?: string; table?: string; record?: SosRecord };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const record = payload.record;
  if (payload.table !== "sos_requests" || payload.type !== "INSERT" || !record) {
    return NextResponse.json({ success: true, skipped: "not a new SOS" });
  }

  const { latitude, longitude } = record;
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return NextResponse.json({ success: true, skipped: "SOS has no coordinates" });
  }

  // Widest radius any subscriber may choose — prefilter once, then apply each
  // subscriber's own radius precisely below.
  const MAX_RADIUS_KM = 100;
  const box = boundingBox(latitude, longitude, MAX_RADIUS_KM);

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, lat, lng, radius_km, district, wants_sos, wants_alerts")
    .eq("wants_sos", true)
    .gte("lat", box.minLat)
    .lte("lat", box.maxLat)
    .gte("lng", box.minLng)
    .lte("lng", box.maxLng);

  if (error) {
    console.error("Dispatch subscriber lookup failed:", error.message);
    return NextResponse.json({ success: false, error: "Subscriber lookup failed" }, { status: 500 });
  }

  const subs = (data ?? []) as PushSubscriptionRow[];
  const area = nearestDistrict(latitude, longitude);
  const people = record.people_count ?? 1;

  const targets = subs
    .map((sub) => ({ sub, km: getDistanceKm(latitude, longitude, sub.lat, sub.lng) }))
    .filter(({ sub, km }) => km <= sub.radius_km)
    .map(({ sub, km }) => {
      // Deliberately no name and no phone number: a push renders on a lock
      // screen that anyone holding the phone can read. Responders get the
      // identifying details after they open the dashboard.
      const payloadForSub: PushPayload = {
        kind: "sos",
        title: `SOS ${formatDistance(km)} away`,
        body: `${people} ${people === 1 ? "person needs" : "people need"} rescue${
          area ? ` near ${area}` : ""
        }. Tap to see the location.`,
        url: `/?focus=${record.id}`,
        tag: `sos-${record.id}`,
      };
      return { sub, payload: payloadForSub };
    });

  const result = await sendToSubscriptions(targets);

  return NextResponse.json({
    success: true,
    candidates: subs.length,
    matched: targets.length,
    ...result,
  });
}
