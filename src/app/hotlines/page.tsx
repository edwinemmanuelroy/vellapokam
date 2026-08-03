import type { Metadata } from "next";
import Link from "next/link";
import { HOTLINE_GROUPS, KSDMA_DIRECTORY_URL } from "@/lib/hotlines";

export const metadata: Metadata = {
  title: "Emergency Hotlines — Kerala Flood Dashboard",
  description:
    "Verified Kerala emergency numbers: 112 for any emergency, 1077 for your district disaster control room, plus fire, ambulance, child and women's helplines.",
};

/**
 * Emergency hotlines.
 *
 * Deliberately a static server component with no data fetching: this page must
 * render when Supabase, the alert feed and every upstream API are down. It is
 * the last thing that still has to work.
 */
export default function HotlinesPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 pb-16 sm:px-6">
      <header className="mb-6 border-b border-surface-800 pb-4">
        <Link
          href="/"
          className="mb-3 inline-block rounded-sm py-2 pr-2 text-[11px] font-bold uppercase tracking-widest text-surface-500 transition hover:text-surface-200"
        >
          ← Dashboard
        </Link>
        <h1 className="text-xl font-bold uppercase tracking-wider text-surface-50">
          Emergency Hotlines
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-surface-400">
          Tap any number to call. All numbers are toll-free unless marked otherwise.
        </p>
      </header>

      <div className="space-y-8">
        {HOTLINE_GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="panel-label mb-1 text-surface-300">{group.title}</h2>
            {group.note && (
              <p className="mb-3 text-[11px] text-surface-500">{group.note}</p>
            )}

            <ul className="space-y-2">
              {group.hotlines.map((h) => (
                <li key={h.number}>
                  {/* Whole row is the tap target — comfortably past 44px, unlike
                      the inline ticker links these replace. */}
                  <a
                    href={`tel:${h.dial}`}
                    className={`flex items-center gap-4 rounded-lg border p-4 transition ${
                      group.emphasis
                        ? "border-emergency-700/60 bg-emergency-950/40 hover:border-emergency-500 hover:bg-emergency-950/70"
                        : "border-surface-800 bg-surface-900 hover:border-surface-600"
                    }`}
                  >
                    <span
                      className={`flex-shrink-0 font-mono font-bold tabular-nums ${
                        group.emphasis
                          ? "text-2xl text-emergency-300"
                          : "text-xl text-surface-100"
                      }`}
                    >
                      {h.number}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-surface-100">
                        {h.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-surface-400">
                        {h.description}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

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
      </section>

      <p className="mt-6 text-center text-[10px] leading-relaxed text-surface-600">
        Numbers verified against KSDMA (sdma.kerala.gov.in). If a number here is
        wrong or out of date, please report it — this page is safety-critical.
      </p>
    </main>
  );
}
