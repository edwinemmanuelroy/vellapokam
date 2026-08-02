"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Advisory } from "@/types/database";
import type { AlertsResponse, OfficialAlert } from "@/types/hydromet";
import MarqueeText from "./MarqueeText";
import { Loader2 } from "lucide-react";

/**
 * One rotation slot in the ticker — either an official SACHET alert
 * (IMD / CWC / SDMA, fetched automatically) or an operator-published advisory.
 */
interface TickerItem {
  key: string;
  title: string;
  message: string;
  tone: "critical" | "warning" | "info";
  createdAt: string | null;
  official: boolean;
}

/**
 * Shown only when neither the official feed nor operators have anything live.
 *
 * This deliberately contains no invented alert content — placeholder text must
 * never be mistakable for a real government warning.
 */
const PLACEHOLDER: TickerItem = {
  key: "placeholder",
  title: "No Active Advisory",
  message:
    "No official alert or operator advisory is currently live. For warnings check KSDMA / IMD directly, or dial 1077 for your district control room.",
  tone: "info",
  createdAt: null,
  official: false,
};

function officialToItem(a: OfficialAlert): TickerItem {
  return {
    key: `official-${a.id}`,
    title: `${a.source} · ${a.event}`,
    message: a.message,
    tone: a.severity === "red" ? "critical" : "warning",
    createdAt: a.start,
    official: true,
  };
}

function advisoryToItem(a: Advisory): TickerItem {
  return {
    key: `advisory-${a.id}`,
    title: a.title,
    message: a.message,
    tone: a.type === "critical" ? "critical" : a.type === "warning" ? "warning" : "info",
    createdAt: a.created_at,
    official: false,
  };
}

export default function GovtAlertsTicker() {
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [officialAlerts, setOfficialAlerts] = useState<OfficialAlert[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  // Fetch operator advisories from database
  const fetchAdvisories = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("advisories")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setAdvisories((data as Advisory[]) ?? []);
    } catch (err) {
      console.error("Failed to load advisories:", err);
      setAdvisories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Official SACHET alerts (IMD / CWC / SDMA) — auto-fed so government
  // warnings reach the public even when no operator is on shift.
  const fetchOfficial = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) return;
      const data: AlertsResponse = await res.json();
      if (data.success) setOfficialAlerts(data.alerts);
    } catch {
      // Feed down — keep whatever we last showed.
    }
  }, []);

  // Real-time advisories subscription + official feed polling
  useEffect(() => {
    fetchAdvisories();
    fetchOfficial();

    const officialTimer = setInterval(fetchOfficial, 10 * 60 * 1000);

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
      clearInterval(officialTimer);
      supabase.removeChannel(channel);
    };
  }, [fetchAdvisories, fetchOfficial]);

  // One rotation: official alerts first, then operator advisories.
  const items = useMemo<TickerItem[]>(
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

  const activeItem = items[currentIndex] ?? PLACEHOLDER;

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
      {/* Helpline shortcuts — plain text, mono numerals */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-surface-800 px-4 py-2 md:border-b-0 md:border-r">
        <span className="panel-label">Hotlines</span>
        <div className="flex items-center gap-2 font-mono text-sm font-bold text-surface-100">
          <a href="tel:1077" className="hover:underline" title="District control room">
            1077
          </a>
          <span className="text-surface-700">·</span>
          <a href="tel:112" className="hover:underline" title="Police">
            112
          </a>
        </div>
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
            {activeItem.official && (
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

        {/* Controls — text glyphs, no icons */}
        {items.length > 1 && (
          <div className="flex flex-shrink-0 items-center gap-1">
            <button
              onClick={handlePrev}
              aria-label="Previous advisory"
              className="flex h-6 w-6 items-center justify-center rounded-sm border border-surface-800 text-surface-500 transition hover:text-surface-200"
            >
              ‹
            </button>
            <span className="font-mono text-[9px] text-surface-600">
              {currentIndex + 1}/{items.length}
            </span>
            <button
              onClick={handleNext}
              aria-label="Next advisory"
              className="flex h-6 w-6 items-center justify-center rounded-sm border border-surface-800 text-surface-500 transition hover:text-surface-200"
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
