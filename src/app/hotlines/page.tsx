import type { Metadata } from "next";
import Link from "next/link";
import { HOTLINE_GROUPS, KSDMA_DIRECTORY_URL } from "@/lib/hotlines";
import AdvisoryList from "@/components/Advisories/AdvisoryList";

export const metadata: Metadata = {
  title: "Warnings & Emergency Hotlines — Kerala Flood Dashboard",
  description:
    "The full text of every live IMD, CWC and SDMA warning for Kerala, plus verified emergency numbers — 112 for any emergency, 1077 for your district disaster control room.",
};

/** Numbers short enough to sit in the one-line quick-dial strip. */
const QUICK_DIAL = HOTLINE_GROUPS.filter((g) => g.quickDial);
/** Everything else — office lines, rendered with the directory below. */
const OTHER_NUMBERS = HOTLINE_GROUPS.filter((g) => !g.quickDial);

/**
 * Live warnings, and the numbers to call about them.
 *
 * The quick-dial strip is a static server render with no data fetching, on
 * purpose: it must appear when Supabase, the alert feed and every upstream API
 * are down. It is the last thing that still has to work.
 *
 * The advisory list below it is a client island (`AdvisoryList`) that hydrates
 * separately — it can fail, load slowly, or show a feed-unavailable banner
 * without ever delaying or displacing the numbers above it.
 */
export default function HotlinesPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 pb-16 sm:px-6">
      <header className="mb-4">
        <Link
          href="/"
          className="mb-3 inline-block rounded-sm py-2 pr-2 text-[11px] font-bold uppercase tracking-widest text-surface-500 transition hover:text-surface-200"
        >
          ← Dashboard
        </Link>
        <h1 className="text-xl font-bold uppercase tracking-wider text-surface-50">
          Warnings &amp; Hotlines
        </h1>
      </header>

      {/* ── Quick dial ───────────────────────────────────────────────────────
          One line at every width. Below `sm` the tiles keep a legible fixed
          width and the strip scrolls rather than shrinking the digits to
          nothing — the three red ones lead, so what you reach for first is
          what you see first. */}
      <nav aria-label="Emergency numbers" className="mb-2">
        <ul className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar sm:gap-2 sm:overflow-x-visible sm:pb-0">
          {QUICK_DIAL.flatMap((group) =>
            group.hotlines.map((h) => (
              <li
                key={h.number}
                className="w-[84px] flex-shrink-0 sm:w-auto sm:flex-1 sm:flex-shrink"
              >
                {/* `title` carries the full description the tile cannot. */}
                <a
                  href={`tel:${h.dial}`}
                  title={`${h.label} — ${h.description}`}
                  className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-3 text-center transition ${
                    group.emphasis
                      ? "border-emergency-700/60 bg-emergency-950/40 hover:border-emergency-500 hover:bg-emergency-950/70"
                      : "border-surface-800 bg-surface-900 hover:border-surface-600"
                  }`}
                >
                  <span
                    className={`font-mono text-base font-bold leading-none tabular-nums sm:text-lg ${
                      group.emphasis ? "text-emergency-300" : "text-surface-100"
                    }`}
                  >
                    {h.number}
                  </span>
                  <span className="w-full truncate text-[9px] font-bold uppercase tracking-wider text-surface-400">
                    {h.short}
                  </span>
                </a>
              </li>
            ))
          )}
        </ul>
      </nav>

      {/* The group headings this strip replaced carried real safety context —
          which numbers are for danger right now. One line keeps it. */}
      <p className="mb-6 border-b border-surface-800 pb-4 text-[11px] leading-relaxed text-surface-500">
        Tap to call. <strong className="text-surface-300">112, 1077 and 1079</strong>{" "}
        are the ones to dial if you are in danger right now — all toll-free.
      </p>

      {/* ── Live warnings — the reason most people open this page ─────────── */}
      <AdvisoryList />

      <section className="mt-8 rounded-lg border border-surface-800 bg-surface-900 p-4">
        <h2 className="panel-label mb-2 text-surface-300">District &amp; taluk numbers</h2>
        <p className="text-[11px] leading-relaxed text-surface-400">
          <strong className="text-surface-200">1077 already routes to your own district</strong>{" "}
          control room, so you rarely need a specific number. For the full
          district and taluk directory, KSDMA publishes the authoritative list —
          it is not copied here, because a stale emergency number is worse than
          no number at all.
        </p>
        <a
          href={KSDMA_DIRECTORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-sm border border-surface-600 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-surface-200 transition hover:bg-surface-800"
        >
          KSDMA directory →
        </a>

        {/* Office lines. Kept out of the quick-dial strip on purpose — these
            are not answered by a control room. */}
        {OTHER_NUMBERS.map((group) => (
          <div key={group.title} className="mt-4 border-t border-surface-800 pt-3">
            <h3 className="panel-label mb-1 text-surface-400">{group.title}</h3>
            {group.note && (
              <p className="mb-2 text-[11px] text-surface-500">{group.note}</p>
            )}
            <ul className="space-y-1.5">
              {group.hotlines.map((h) => (
                <li key={h.number}>
                  <a
                    href={`tel:${h.dial}`}
                    className="flex items-baseline gap-3 rounded-sm py-2 transition hover:text-surface-100"
                  >
                    <span className="font-mono text-sm font-bold tabular-nums text-surface-100">
                      {h.number}
                    </span>
                    <span className="min-w-0 text-[11px] leading-relaxed text-surface-400">
                      {h.description}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <p className="mt-6 text-center text-[10px] leading-relaxed text-surface-600">
        Numbers verified against KSDMA (sdma.kerala.gov.in). If a number here is
        wrong or out of date, please report it — this page is safety-critical.
      </p>
    </main>
  );
}
