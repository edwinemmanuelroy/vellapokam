"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import type { Advisory } from "@/types/database";
import type { OfficialAlert } from "@/types/hydromet";
// The ticker and the full listing on /hotlines render the same items — one
// rotating, one expanded — so the normalisation is shared rather than copied.
import {
  advisoryToItem,
  officialToItem,
  FEED_UNAVAILABLE,
  PLACEHOLDER,
  type AdvisoryItem,
} from "@/lib/advisories";
import MarqueeText from "./MarqueeText";
import { Loader2 } from "lucide-react";

interface Props {
  /**
   * Official alerts, fetched once by the dashboard and passed down. This
   * component used to poll /api/alerts itself on a 10-minute cadence while the
   * page polled the same endpoint on a 15-minute one — two requests from every
   * phone, forever, for identical data.
   */
  officialAlerts?: OfficialAlert[];
  /** True when the alert feed could not be reached. */
  officialFeedFailed?: boolean;
}

export default function GovtAlertsTicker({
  officialAlerts = [],
  officialFeedFailed = false,
}: Props) {
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [feedFailed, setFeedFailed] = useState(false);

  // Fetch operator advisories from database
  const fetchAdvisories = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("advisories")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setAdvisories((data as Advisory[]) ?? []);
      setFeedFailed(false);
    } catch (err) {
      console.error("Failed to load advisories:", err);
      setAdvisories([]);
      // Do NOT fall through to the "no active advisory" placeholder — that
      // states an all-clear this app cannot verify.
      setFeedFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Official SACHET alerts (IMD / CWC / SDMA) arrive as a prop from the
  // dashboard, which already polls /api/alerts on the shared refresh cycle.

  // Real-time advisories subscription
  useEffect(() => {
    fetchAdvisories();

    const channel = supabase
      .channel("advisories-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "advisories" },
        () => {
          fetchAdvisories();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAdvisories]);

  // One rotation: official alerts first, then operator advisories.
  const items = useMemo<AdvisoryItem[]>(
    () => [
      ...officialAlerts.map(officialToItem),
      ...advisories.map(advisoryToItem),
    ],
    [officialAlerts, advisories]
  );

  // Keep the cursor valid when a refetch returns a shorter list
  useEffect(() => {
    setCurrentIndex((prev) => (items.length === 0 ? 0 : Math.min(prev, items.length - 1)));
  }, [items.length]);

  // How long the current message takes to scroll once (null = it fits).
  const [marqueeSeconds, setMarqueeSeconds] = useState<number | null>(null);
  // Set while the reader is hovering or keyboard-focused inside the ticker.
  const [paused, setPaused] = useState(false);

  // Rotation timer. Two rules, both about not stealing text mid-read:
  //  * dwell grows to cover one full scroll pass, so a long Malayalam alert is
  //    never swapped out mid-sentence;
  //  * it stops entirely while someone is interacting with the ticker.
  useEffect(() => {
    if (items.length <= 1 || paused) return;
    const dwellMs = Math.max(8000, marqueeSeconds ? marqueeSeconds * 1000 + 1500 : 0);
    const timer = setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % items.length);
    }, dwellMs);
    return () => clearTimeout(timer);
  }, [items.length, marqueeSeconds, currentIndex, paused]);

  // Only claim "no active advisory" when we actually reached both feeds.
  const anyFeedFailed = feedFailed || officialFeedFailed;
  const activeItem =
    items[currentIndex] ?? (anyFeedFailed ? FEED_UNAVAILABLE : PLACEHOLDER);

  const handleNext = () => {
    if (items.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % items.length);
  };

  const handlePrev = () => {
    if (items.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + items.length) % items.length);
  };

  const formatTime = (timeStr: string) => {
    const ms = Date.now() - new Date(timeStr).getTime();
    const min = Math.floor(ms / (1000 * 60));
    if (min < 1) return "Just now";
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(timeStr).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  };

  // Signal colors only: red = critical, amber = warning, gray = info
  const typeColor =
    activeItem.tone === "critical"
      ? "text-emergency-400 border-emergency-600/50"
      : activeItem.tone === "warning"
      ? "text-warning-400 border-warning-600/50"
      : "text-surface-400 border-surface-700";

  return (
    <div className="w-full card-glass overflow-hidden flex flex-col md:flex-row items-stretch min-h-[46px]">
      {/* Helpline shortcuts. Tap targets are deliberately generous — these are
          dialled one-handed by someone in trouble. */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-surface-800 px-3 py-1.5 md:border-b-0 md:border-r">
        <span className="panel-label hidden sm:inline">Hotlines</span>
        <div className="flex items-center gap-1 font-mono text-sm font-bold text-surface-100">
          <a
            href="tel:112"
            className="rounded-sm px-2.5 py-2.5 hover:bg-surface-800 hover:underline"
            title="Emergency — police, fire and ambulance"
          >
            112
          </a>
          <a
            href="tel:1077"
            className="rounded-sm px-2.5 py-2.5 hover:bg-surface-800 hover:underline"
            title="District emergency operations centre"
          >
            1077
          </a>
        </div>
        <Link
          href="/hotlines"
          className="rounded-sm px-2 py-2.5 text-[10px] font-bold uppercase tracking-wider text-surface-400 transition hover:text-surface-100"
        >
          All →
        </Link>
      </div>

      {/* Ticker content. Hovering or tabbing in freezes both the scroll and
          the rotation — moving text you cannot stop is the classic reason
          people miss an emergency message entirely. */}
      <div
        className="flex flex-1 items-center justify-between gap-4 overflow-hidden px-4 py-2"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-surface-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading advisories…
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-3 overflow-hidden">
            <span
              className={`flex-shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${typeColor}`}
            >
              {activeItem.title}
            </span>
            {activeItem.provenance === "official" && (
              <span className="source-chip flex-shrink-0">Official</span>
            )}
            {/* `key` remounts the marquee per message so a new alert always
                starts from the left rather than mid-scroll. */}
            <MarqueeText
              key={activeItem.key}
              text={activeItem.message}
              onDurationChange={setMarqueeSeconds}
              className={`flex-1 text-xs font-medium md:text-sm ${
                activeItem.tone === "critical" ? "text-emergency-300" : "text-surface-200"
              }`}
            />
            {activeItem.createdAt && (
              <span className="hidden whitespace-nowrap font-mono text-[10px] text-surface-500 sm:inline">
                {formatTime(activeItem.createdAt)}
              </span>
            )}
          </div>
        )}

        {/* Scrolling text is for noticing an alert, not reading one. This is
            the way out to the full wording of every live advisory. */}
        {items.length > 0 && (
          <Link
            href="/hotlines#advisories"
            className="flex-shrink-0 whitespace-nowrap rounded-sm px-2 py-2.5 text-[10px] font-bold uppercase tracking-wider text-surface-400 transition hover:text-surface-100"
          >
            Full text →
          </Link>
        )}

        {/* Controls — text glyphs, no icons */}
        {items.length > 1 && (
          <div className="flex flex-shrink-0 items-center gap-1">
            <button
              onClick={handlePrev}
              aria-label="Previous advisory"
              className="flex h-9 w-9 items-center justify-center rounded-sm border border-surface-800 text-surface-500 transition hover:text-surface-200"
            >
              ‹
            </button>
            <span className="font-mono text-[9px] text-surface-600">
              {currentIndex + 1}/{items.length}
            </span>
            <button
              onClick={handleNext}
              aria-label="Next advisory"
              className="flex h-9 w-9 items-center justify-center rounded-sm border border-surface-800 text-surface-500 transition hover:text-surface-200"
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
