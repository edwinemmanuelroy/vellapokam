"use client";

import React, { useState } from "react";
import { Loader2, X } from "lucide-react";
import { useWebPush, DEFAULT_RADIUS_KM } from "./useWebPush";
import { useToast } from "@/components/Toast/ToastProvider";

/**
 * Consent surface for proximity rescue alerts.
 *
 * The primer explains *why* before the browser prompt ever appears. That
 * ordering is the whole point: a browser denial is permanent for the origin,
 * so asking cold would permanently cost us the ability to reach that person's
 * lock screen when a neighbour is trapped.
 */

const DISMISS_KEY = "sos_alerts_primer_dismissed";

interface Props {
  /** Caller's current coordinates — required to target alerts. */
  coords: { lat: number; lng: number };
  /** True when `coords` came from real GPS rather than the Kochi fallback. */
  hasRealLocation: boolean;
  onRequestLocation: () => void;
  variant?: "banner" | "panel";
}

export default function NotificationConsent({
  coords,
  hasRealLocation,
  onRequestLocation,
  variant = "banner",
}: Props) {
  const { status, subscribed, busy, error, radiusKm, enable, disable } = useWebPush();
  const { showToast } = useToast();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  });

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode — dismissal just won't persist */
    }
  };

  const handleEnable = async () => {
    if (!hasRealLocation) {
      onRequestLocation();
      showToast({
        title: "Location needed",
        message:
          "Share your location first so alerts can be limited to emergencies actually near you.",
        tone: "info",
      });
      return;
    }
    const ok = await enable(coords, DEFAULT_RADIUS_KM);
    if (ok) {
      showToast({
        title: "Alerts on",
        message: `You'll be notified when someone within ${DEFAULT_RADIUS_KM} km needs rescue.`,
        tone: "success",
      });
    }
  };

  const handleDisable = async () => {
    await disable();
    showToast({ title: "Alerts off", message: "You will no longer receive rescue alerts.", tone: "info" });
  };

  if (status === "loading" || status === "unsupported") return null;

  /* ── Active state: compact control, always available ─────────────────── */
  if (status === "granted" && subscribed) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-surface-800 bg-surface-900 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-emergency-500" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-surface-300">
            Rescue alerts on · {radiusKm} km
          </span>
        </div>
        <button
          onClick={handleDisable}
          disabled={busy}
          className="text-[10px] font-bold uppercase tracking-wider text-surface-500 transition hover:text-surface-200 disabled:opacity-50"
        >
          {busy ? "…" : "Turn off"}
        </button>
      </div>
    );
  }

  if (dismissed && variant === "banner") return null;

  const containerClass =
    variant === "banner"
      ? "rounded-lg border border-surface-700 bg-surface-900 p-4"
      : "rounded-lg border border-surface-800 bg-surface-900 p-3";

  /* ── iOS: the API only exists once installed to the Home Screen ──────── */
  if (status === "needs-install") {
    return (
      <div className={containerClass}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-surface-200">
              Get rescue alerts on this iPhone
            </h3>
            <p className="text-[11px] leading-relaxed text-surface-400">
              Apple only allows alerts for apps added to the Home Screen. Tap{" "}
              <strong className="text-surface-200">Share</strong> in Safari, then{" "}
              <strong className="text-surface-200">Add to Home Screen</strong>, and open
              the dashboard from there to turn on alerts.
            </p>
          </div>
          {variant === "banner" && (
            <button onClick={dismiss} aria-label="Dismiss" className="-m-2 rounded-sm p-2 text-surface-600 hover:text-surface-300">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ── Blocked: cannot re-prompt; explain the manual recovery path ─────── */
  if (status === "denied") {
    return (
      <div className={containerClass}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-surface-200">
              Rescue alerts are blocked
            </h3>
            <p className="text-[11px] leading-relaxed text-surface-400">
              Your browser is blocking notifications for this site. To receive alerts when
              someone nearby needs rescue, allow notifications in your browser&apos;s site
              settings (the icon at the left of the address bar).
            </p>
          </div>
          {variant === "banner" && (
            <button onClick={dismiss} aria-label="Dismiss" className="-m-2 rounded-sm p-2 text-surface-600 hover:text-surface-300">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ── Primer: state the reason plainly, then ask ──────────────────────── */
  return (
    <div className={containerClass}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-surface-100">
            Get alerted when someone near you needs rescue
          </h3>

          <p className="text-[11px] leading-relaxed text-surface-300">
            In a flood, a neighbour with a boat almost always reaches a trapped family
            faster than a team dispatched from the district control room. Turning on
            alerts lets this dashboard tell you the moment an SOS is filed within{" "}
            <strong className="text-surface-100">{DEFAULT_RADIUS_KM} km</strong> of you —
            so help can start moving immediately, and so responders can judge how bad the
            situation on the ground really is.
          </p>

          <ul className="space-y-1 text-[10px] leading-relaxed text-surface-500">
            <li>
              <strong className="text-surface-400">What you&apos;ll get:</strong> a new SOS
              within {DEFAULT_RADIUS_KM} km, plus red and orange government warnings for your
              district. Nothing else — no marketing, ever.
            </li>
            <li>
              <strong className="text-surface-400">What we store:</strong> an anonymous
              device token and your location rounded to about 1 km. No name, no phone
              number, nothing that identifies you.
            </li>
            <li>
              <strong className="text-surface-400">Your control:</strong> turn alerts off in
              one tap, any time.
            </li>
          </ul>

          {error && (
            <p className="text-[10px] font-semibold text-emergency-400">{error}</p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={handleEnable}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-sm bg-emergency-600 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white transition hover:bg-emergency-500 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              Enable rescue alerts
            </button>
            {variant === "banner" && (
              <button
                onClick={dismiss}
                className="text-[10px] font-bold uppercase tracking-wider text-surface-500 transition hover:text-surface-300"
              >
                Not now
              </button>
            )}
          </div>
        </div>

        {variant === "banner" && (
          <button onClick={dismiss} aria-label="Dismiss" className="-m-2 rounded-sm p-2 text-surface-600 hover:text-surface-300">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
