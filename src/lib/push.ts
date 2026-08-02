import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

/**
 * Server-side Web Push plumbing.
 *
 * Reachable only from `/api/push/*` route handlers — it holds the service-role
 * key, which bypasses RLS. `server-only` makes an accidental client import a
 * build error rather than a credential leak.
 */

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lat: number;
  lng: number;
  radius_km: number;
  district: string | null;
  wants_sos: boolean;
  wants_alerts: boolean;
}

/** Payload delivered to the service worker. Keep it free of personal data. */
export interface PushPayload {
  kind: "sos" | "alert";
  title: string;
  body: string;
  url: string;
  tag?: string;
}

let cachedAdmin: SupabaseClient | null = null;

/**
 * Supabase client with the service-role key. Throws rather than silently
 * degrading: a push route that cannot reach the database must fail loudly.
 */
export function getAdminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Push is not configured: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
    );
  }

  cachedAdmin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdmin;
}

let vapidReady = false;

/** True when VAPID keys are present — routes 503 instead of throwing if not. */
export function isPushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function ensureVapid(): void {
  if (vapidReady) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys are not configured.");
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:ops@example.org",
    publicKey,
    privateKey
  );
  vapidReady = true;
}

/**
 * Timing-safe comparison for the webhook shared secret. A plain `===` leaks
 * the secret's prefix through response timing.
 */
export function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Send one payload per subscription (payloads differ — each recipient sees
 * their own distance) and prune endpoints the push service has retired.
 *
 * Returns counts rather than throwing: one dead device must never fail the
 * whole dispatch.
 */
export async function sendToSubscriptions(
  targets: Array<{ sub: PushSubscriptionRow; payload: PushPayload }>
): Promise<{ sent: number; failed: number; pruned: number }> {
  if (targets.length === 0) return { sent: 0, failed: 0, pruned: 0 };
  ensureVapid();

  const stale: string[] = [];
  let sent = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    targets.map(({ sub, payload }) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
        { TTL: 60 * 30 } // half an hour: a stale rescue alert helps nobody
      )
    )
  );

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      sent++;
      return;
    }
    failed++;
    // 404/410 mean the browser dropped this subscription for good.
    const status = (result.reason as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) {
      stale.push(targets[i].sub.endpoint);
    } else {
      console.error("Push send failed:", status, result.reason);
    }
  });

  let pruned = 0;
  if (stale.length > 0) {
    const { error } = await getAdminClient()
      .from("push_subscriptions")
      .delete()
      .in("endpoint", stale);
    if (error) {
      console.error("Failed to prune stale push subscriptions:", error.message);
    } else {
      pruned = stale.length;
    }
  }

  return { sent, failed, pruned };
}
