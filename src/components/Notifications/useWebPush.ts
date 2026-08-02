"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Web Push subscription lifecycle.
 *
 * Hard rule enforced here: the browser permission prompt is only ever raised
 * from `enable()`, which must be called from a user gesture. A denial is
 * permanent per-origin — auto-prompting on load would burn the one chance this
 * site gets to reach someone's lock screen.
 */

export type PushStatus =
  | "loading"
  | "unsupported"        // browser has no Push API
  | "needs-install"      // iOS Safari: works only once added to Home Screen
  | "default"            // supported, not yet asked
  | "granted"            // permission granted (may or may not be subscribed)
  | "denied";            // blocked; only recoverable via browser settings

export interface WebPushState {
  status: PushStatus;
  subscribed: boolean;
  busy: boolean;
  error: string | null;
  radiusKm: number;
  enable: (coords: { lat: number; lng: number }, radiusKm?: number) => Promise<boolean>;
  disable: () => Promise<void>;
}

/** URL-safe base64 (VAPID) → Uint8Array, as `applicationServerKey` requires. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Macintosh; the touch-point check disambiguates.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export const DEFAULT_RADIUS_KM = 25;

export function useWebPush(): WebPushState {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);

  // Detect capability and current permission. Never prompts.
  useEffect(() => {
    let cancelled = false;

    const detect = async () => {
      const hasApi =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;

      if (!hasApi) {
        // On iOS the API genuinely appears only once installed, so tell the
        // user how to get it rather than calling their device unsupported.
        if (!cancelled) setStatus(isIosDevice() && !isStandalone() ? "needs-install" : "unsupported");
        return;
      }

      const permission = Notification.permission;
      if (permission === "denied") {
        if (!cancelled) setStatus("denied");
        return;
      }

      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const existing = await reg?.pushManager.getSubscription();
        if (cancelled) return;
        setSubscribed(Boolean(existing));
        setStatus(permission === "granted" ? "granted" : "default");
      } catch {
        if (!cancelled) setStatus(permission === "granted" ? "granted" : "default");
      }
    };

    detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(
    async (coords: { lat: number; lng: number }, requestedRadius = DEFAULT_RADIUS_KM) => {
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        setError("Alerts are not configured on this deployment yet.");
        return false;
      }

      setBusy(true);
      setError(null);
      try {
        // Called from a click handler — this is the only prompt in the app.
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setStatus(permission === "denied" ? "denied" : "default");
          setError(
            permission === "denied"
              ? "Alerts are blocked. You can re-enable them in your browser's site settings."
              : "Alerts were not enabled."
          );
          return false;
        }

        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;

        // Reuse an existing subscription; re-subscribing would orphan the old
        // endpoint server-side.
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
          }));

        const json = subscription.toJSON() as {
          endpoint?: string;
          keys?: { p256dh?: string; auth?: string };
        };

        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
            lat: coords.lat,
            lng: coords.lng,
            radiusKm: requestedRadius,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Could not save your alert settings.");
        }

        setRadiusKm(data.radiusKm ?? requestedRadius);
        setStatus("granted");
        setSubscribed(true);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not enable alerts.";
        setError(msg);
        return false;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        // Tell the server first — if the browser-side unsubscribe succeeded but
        // the row survived, we would keep pushing into a dead endpoint.
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => {});
        await subscription.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not turn off alerts.");
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, subscribed, busy, error, radiusKm, enable, disable };
}
