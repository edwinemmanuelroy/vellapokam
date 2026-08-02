import { NextResponse } from "next/server";
import {
  getAdminClient,
  isPushConfigured,
  secretMatches,
  sendToSubscriptions,
  type PushPayload,
  type PushSubscriptionRow,
} from "@/lib/push";
import { fetchKeralaAlerts } from "@/lib/sachet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled sweep that pushes NEW red/orange official warnings (IMD / Kerala
 * SDMA / CWC via SACHET) to subscribers in the affected districts.
 *
 * The SACHET feed keeps returning the same active alerts every poll, so
 * `pushed_alerts` records what has already gone out — without it every sweep
 * would re-notify everyone and the channel would be worthless within a day.
 *
 * Run from Vercel Cron (see vercel.json) or any external scheduler. Auth is
 * the same shared secret as the dispatch webhook; Vercel Cron's own
 * `Authorization: Bearer $CRON_SECRET` header is accepted too.
 */
function isAuthorized(request: Request): boolean {
  if (secretMatches(request.headers.get("x-webhook-secret"), process.env.PUSH_WEBHOOK_SECRET)) {
    return true;
  }
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

async function sweep(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!isPushConfigured()) {
    return NextResponse.json(
      { success: false, error: "Push is not configured on this deployment." },
      { status: 503 }
    );
  }

  const alerts = await fetchKeralaAlerts();
  if (alerts === null) {
    return NextResponse.json(
      { success: false, error: "Official alert feed (SACHET) unreachable" },
      { status: 502 }
    );
  }

  // Only the two severities worth waking a phone for. Yellow advisories stay
  // in the in-app ticker — pushing them would train people to ignore the buzz.
  const urgent = alerts.filter((a) => a.severity === "red" || a.severity === "orange");
  if (urgent.length === 0) {
    return NextResponse.json({ success: true, considered: 0, pushed: 0 });
  }

  const admin = getAdminClient();

  const { data: alreadyPushed, error: pushedError } = await admin
    .from("pushed_alerts")
    .select("alert_id")
    .in("alert_id", urgent.map((a) => a.id));

  if (pushedError) {
    console.error("pushed_alerts lookup failed:", pushedError.message);
    return NextResponse.json({ success: false, error: "Dedupe lookup failed" }, { status: 500 });
  }

  const seen = new Set((alreadyPushed ?? []).map((r) => (r as { alert_id: string }).alert_id));
  const fresh = urgent.filter((a) => !seen.has(a.id));
  if (fresh.length === 0) {
    return NextResponse.json({ success: true, considered: urgent.length, pushed: 0 });
  }

  const { data: subData, error: subError } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, lat, lng, radius_km, district, wants_sos, wants_alerts")
    .eq("wants_alerts", true);

  if (subError) {
    console.error("Alert subscriber lookup failed:", subError.message);
    return NextResponse.json({ success: false, error: "Subscriber lookup failed" }, { status: 500 });
  }

  const subs = (subData ?? []) as PushSubscriptionRow[];
  let totalSent = 0;
  const recorded: { alert_id: string; severity: string }[] = [];

  for (const alert of fresh) {
    // A statewide alert (no districts parsed) goes to everyone; a district
    // alert only to subscribers in those districts.
    const statewide = alert.districts.length === 0;
    const targets = subs
      .filter((sub) => statewide || (sub.district && alert.districts.includes(sub.district)))
      .map((sub) => {
        const payload: PushPayload = {
          kind: "alert",
          title: `${alert.severity === "red" ? "RED" : "ORANGE"} — ${alert.event}`,
          body: `${alert.source}: ${alert.message.slice(0, 160)}`,
          url: "/",
          tag: `alert-${alert.id}`,
        };
        return { sub, payload };
      });

    if (targets.length > 0) {
      const result = await sendToSubscriptions(targets);
      totalSent += result.sent;
    }
    // Recorded even when nobody was in range, so a later sweep does not
    // reconsider an alert that has already been handled.
    recorded.push({ alert_id: alert.id, severity: alert.severity });
  }

  if (recorded.length > 0) {
    const { error: insertError } = await admin
      .from("pushed_alerts")
      .upsert(recorded, { onConflict: "alert_id" });
    if (insertError) {
      console.error("Failed to record pushed alerts:", insertError.message);
    }
  }

  // Keep the dedupe ledger bounded. Official alerts expire in hours, so a
  // 7-day window is far longer than any alert can still be active — an id
  // older than that will never be seen in the feed again.
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error: pruneError } = await admin
    .from("pushed_alerts")
    .delete()
    .lt("pushed_at", cutoff);
  if (pruneError) {
    console.error("Failed to prune pushed_alerts:", pruneError.message);
  }

  return NextResponse.json({
    success: true,
    considered: urgent.length,
    pushed: fresh.length,
    notificationsSent: totalSent,
  });
}

export async function POST(request: Request) {
  return sweep(request);
}

// Vercel Cron issues GET requests.
export async function GET(request: Request) {
  return sweep(request);
}
