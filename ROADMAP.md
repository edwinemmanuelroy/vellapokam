# Roadmap — Kerala Flood Emergency Dashboard

The system is SOS-first: every phase below is ordered by how directly it helps a
trapped person get rescued. Telemetry and polish come after queue integrity and
reach.

## Current state (shipped)

- SOS-first public dashboard: one-tap SOS entry, pending-first rescue queue with
  waiting-time escalation, SOS command strip, top-layer map beacons, compact map.
- **Proximity push notifications**: opt-in alerts to devices within 25 km of a new
  SOS, plus red/orange official warnings. Explicit consent primer, coarse
  (~1.1 km) locations, no PII in payloads, iOS install path handled.
- **In-app toasts** for new SOS, sticky when nearby.
- **Verified rescues**: the public reports, an operator confirms. `anon` can no
  longer write `status` at all.
- Ops console (`/admin`): operator auth, SOS queue with confirm/dismiss of public
  rescue reports, flood report verification, advisory publish/retract.
- Official data: KSDMA daily dam bulletins (PDF-parsed), NDMA SACHET CAP alerts
  (IMD/SDMA/CWC) in the ticker, river overlays, and the weather banner.
- Hardened Supabase: column-level anon grants, Kerala-bbox CHECK constraints,
  constrained photo bucket, service-role-only push tables, migrations
  `00001`–`00008`.
- PWA shell (manifest, service worker, icons) — the prerequisite for offline SOS.
- OSM basemap used per the OSMF tile policy, env-swappable provider.

---

## P1 — Rescue integrity & reach (do first)

| Item | Why it matters for SOS | Rough effort |
| --- | --- | --- |
| **Offline SOS submission** | Networks fail exactly when SOS volume peaks. The PWA shell now exists; add a background-sync queue so an SOS composed with no signal is stored on-device and transmitted when connectivity returns, with a clear "queued, not yet sent" state. **Highest-value remaining item.** | 2–3 days |
| **SOS dedupe & merge** | The same family reported by 3 relatives shows as 3 rescues — and now triggers 3 push notifications to every neighbour. Cluster by phone + proximity (<150 m), merge in the ops console. Notification fatigue makes this more urgent than before. | 2–3 days |
| **Malayalam UI** | Most people typing an SOS in a Kerala flood think in Malayalam. `next-intl`, ml-first toggle, Malayalam form labels/placeholders — and Malayalam push payloads. | 2–3 days |
| **Server-side rate limiting** | The 30 s cooldown is client-side only. Now that an insert fans out to push notifications, a scripted flood is an amplification attack, not just spam. Token bucket in middleware (Vercel WAF or Upstash). | 1 day |
| **Push delivery observability** | We currently log send failures to the console. Track per-dispatch sent/failed/pruned counts so a silently-broken push pipeline is visible before an event, not during one. | 0.5 day |
| **Error monitoring + uptime** | A silent crash during an event is lethal. Sentry + external uptime checks on `/` and all API routes, alerting to the ops phone. | 0.5 day |

### Audit backlog (from the UI / performance / correctness audit)

**P1 — correctness & accessibility**

| Item | Why |
| --- | --- |
| Focus trap for the modal and drawer | Both are modal in behaviour (backdrop, Escape, scroll lock) but neither traps Tab or restores focus on close, so keyboard focus walks into the page behind them. The drawer also lacks `role="dialog"`. |
| `aria-pressed` on toggle groups | Water-level and needs selection is conveyed by colour alone; a screen reader hears four identical unlabelled buttons. |
| Make the SOS form a real `<form>` | It is a set of `<div>`s, so Enter does not submit and mobile keyboards show no "Go". |
| `prefers-reduced-motion` for map markers | Each SOS marker runs two infinite `sos-ping` animations; 60 pending requests is 120 permanently-running compositor animations, none of which opt out. |
| Lift `useWebPush` to a context | `NotificationConsent` is mounted twice with independent state, so enabling alerts in the banner leaves the sidebar still showing "Enable". |
| `/api/river-discharge` revalidate | Declares 900s but effectively runs at 600s — Next takes the minimum of nested `fetch` revalidate values, and the SACHET call inside uses 600. |

**P2 — deduplication.** The audit found the same logic written out repeatedly: the status→class map lives in 4 files plus 5 inline ternaries; `SosCard` and `FloodReportCard` each have 3 separate implementations (dashboard, admin, map popup); 4 identical 20-line fetch wrappers want one `useApiFeed` hook; the water-level vocabulary is defined 3× plus a dead `.water-level-bar` CSS block nothing references; and two geolocation implementations disagree on accuracy settings.

**P3 — structure & tooling.** Split the 1750-line `page.tsx`. Replace the Haversine-in-comparator sorts with a Schwartzian transform (~1,400 trig calls per memo recompute, ×4 memos). **Add CI and tests — there is currently no test tooling at all**: start with vitest over the KSDMA PDF parser and the SACHET normaliser (the two brittle seams), plus a Playwright smoke test on the SOS submit path.

### Closed since last revision
- ~~Responder-only "rescued"~~ — addressed in `00008`: `anon` lost the `status`
  column entirely and can only set `rescue_reported_at`; operators confirm.
- ~~A failed fetch rendered as an empty rescue queue~~ — `fetchAll` swallowed
  Supabase errors and stamped a fresh sync anyway, so a broken dashboard was
  indistinguishable from "nobody needs help". Now has an explicit error state,
  and the ticker no longer claims "no active advisory" when it could not reach
  the feed.
- ~~Waiting-time escalation never fired~~ — relative times were computed at
  render only and nothing re-rendered while realtime was connected, so the
  60-minute red threshold was unreachable on a quiet channel.
- ~~News was not chronological~~ — the feed returns ~100 unordered items and the
  route capped at 15 *by feed position*, discarding 13 of the 15 newest.

## P2 — Operations at scale

| Item | Why | Rough effort |
| --- | --- | --- |
| **SOS assignment/claiming** | Two rescue boats shouldn't race to the same house while a third SOS waits — especially now that 25 km of neighbours get the same alert. Operators (and eventually volunteers) claim requests; claimed state visible publicly and pushed as an update. | 2–3 days |
| **Volunteer roles & verified responders** | Right now every subscriber is equivalent. Let people register as boat owners / medics / drivers so an SOS can notify who can actually help with *those* needs. | 3–4 days |
| **Admin audit log** | Every rescued/reopen/verify/retract recorded (who, when, what) — accountability when actions are disputed. | 1 day |
| **Relief-camp layer** | KSDMA publishes camp lists during events; a camp layer turns "rescued" into "sheltered". | 2 days |
| **Ops analytics strip** | Rescues/hour, median waiting time, open-vs-closed — tells the war room whether it's winning. | 1–2 days |
| **Advisory auto-expiry** | Stale advisories erode trust; add `expires_at` + filtered queries. | 0.5 day |

## P3 — Data & scale hardening

| Item | Why | Rough effort |
| --- | --- | --- |
| **Direct CWC/India-WRIS gauges** | Replace modelled discharge with official station series when a stable public endpoint is identified. | investigation + 2 days |
| **Self-hosted PMTiles** | At real event scale (~500k tiles/day) OSM's donated servers are off-limits; PMTiles behind a CDN is near-free and unthrottleable. Requires Leaflet→MapLibre migration. | 3–4 days |
| **CI + tests** | GitHub Actions: tsc/lint/build gates; vitest on the KSDMA PDF parser and SACHET normalizer (the two brittle seams) with recorded fixtures; Playwright smoke on the SOS submit path. | 2 days |
| **Nightly DB export** | SOS data is evidence and history — automated dumps to storage. | 0.5 day |
| **SMS ingestion** | SOS over SMS for feature phones / no-data situations. Needs a telecom/gateway partner (e.g. Exotel) — the biggest reach unlock, and the most external-dependency-bound. | partner-gated |
