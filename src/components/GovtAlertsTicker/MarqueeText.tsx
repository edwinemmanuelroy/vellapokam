"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Horizontally scrolling ticker text.
 *
 * Only scrolls when the content actually overflows — a short advisory that
 * fits stays still, because text drifting for no reason reads as a glitch.
 *
 * Accessibility: continuously moving text is a real problem for people with
 * vestibular or reading difficulties, and WCAG 2.2.2 requires a way to stop
 * motion that runs longer than five seconds. So this pauses on hover and on
 * keyboard focus, and does not animate at all under
 * `prefers-reduced-motion: reduce` (falling back to a static, truncated line).
 */

/** Scroll speed in pixels per second — slow enough to read Malayalam script. */
const PIXELS_PER_SECOND = 55;
/** Gap between the two copies so the loop does not read as one long run-on. */
const GAP_PX = 64;

interface Props {
  text: string;
  className?: string;
  /** Reports the seconds one full pass takes, or null when not scrolling. */
  onDurationChange?: (seconds: number | null) => void;
}

export default function MarqueeText({ text, className = "", onDurationChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const overflowBy = content.scrollWidth - container.clientWidth;
    // A couple of pixels of overflow is measurement noise, not a reason to move.
    const next =
      overflowBy > 4 ? (content.scrollWidth + GAP_PX) / PIXELS_PER_SECOND : null;

    setDuration((prev) => (prev === next ? prev : next));
  }, []);

  // Re-measure on text change and on resize — the same string overflows at
  // 375px and fits at 1440px.
  useEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [measure, text]);

  useEffect(() => {
    onDurationChange?.(reducedMotion ? null : duration);
  }, [duration, reducedMotion, onDurationChange]);

  const scrolling = duration !== null && !reducedMotion;

  if (!scrolling) {
    // Wrap rather than truncate. Under prefers-reduced-motion the scroll is
    // disabled, and truncating left a long government warning clipped to one
    // line with no way to read the rest — the alert became unreadable for
    // exactly the users who opted out of motion.
    return (
      <div ref={containerRef} className={`min-w-0 ${className}`}>
        <span
          ref={contentRef}
          className={reducedMotion ? "block" : "block truncate"}
          title={text}
        >
          {text}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`group min-w-0 overflow-hidden ${className}`}
      // Focusable so keyboard users can pause it too, not just pointer users.
      tabIndex={0}
      role="marquee"
      aria-label={text}
    >
      <div
        className="flex w-max animate-marquee whitespace-nowrap will-change-transform [animation-play-state:running] group-hover:[animation-play-state:paused] group-focus:[animation-play-state:paused]"
        style={{ animationDuration: `${duration}s` }}
      >
        <span ref={contentRef} style={{ paddingRight: GAP_PX }}>
          {text}
        </span>
        {/* Second copy makes the wrap seamless; hidden from assistive tech so
            the alert is not announced twice. */}
        <span style={{ paddingRight: GAP_PX }} aria-hidden="true">
          {text}
        </span>
      </div>
    </div>
  );
}
