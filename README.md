# Kerala Flood Emergency Dashboard

An **SOS-first** rescue-coordination war room built with **Next.js 14 (App Router)**, **Tailwind CSS**, and **Supabase**. Trapped people send SOS requests in seconds; responders see a live pending-first rescue queue with call/directions/dispatch actions; operators verify reports and publish advisories from a dedicated ops console. Flood telemetry (dams, rivers, rainfall) supports the rescue mission — it never crowds it out.

---

## Key Features

**SOS first (`/`)**
- **One-tap SOS**: a dedicated, always-visible red **SOS — Need Help** button opens straight onto the SOS form (name, phone, people count, needs, GPS with draggable fine-tune pin). Flood reporting is the secondary action.
- **Proximity alerts**: opt-in push notifications tell people within **25 km** the moment someone nearby files an SOS — because a neighbour with a boat usually reaches a trapped family faster than a team dispatched from district HQ. Red/orange government warnings are pushed too.
- **In-app toasts**: anyone with the dashboard open gets an immediate toast for each new SOS; nearby ones are sticky until acted on.
- **Rescue queue**: the sidebar's default tab. Pending requests always sort above rescued, each with waiting-time escalation (amber → red past 1 hour), call / directions / WhatsApp-dispatch actions.
- **Verified rescues**: the public *reports* a rescue; the request stays in the queue, flagged, until an operator confirms — a mistaken or malicious tap can never make a trapped family vanish.
- **SOS command strip**: whenever requests are pending, a red strip above the map shows `N ACTIVE SOS · M PEOPLE WAITING` with a jump into the queue.
- **Map**: compact full-color OpenStreetMap basemap that leaves the rescue queue the dominant surface; pulsing SOS beacons are always the top layer, above flood pins, dam squares, and river gauges.

**Official data & telemetry**
- **Dam levels**: parsed daily from **KSDMA's official bulletins** (KSEB + Irrigation Department PDFs) — real gauge readings, alert stages, and shutter remarks, per-dam `KSDMA` chip. Dams missing from the day's bulletin fall back to a clearly-labelled rainfall estimate (`EST`).
- **Official alerts**: NDMA's **SACHET CAP feed** (IMD district warnings, Kerala SDMA advisories, CWC river flood forecasts) auto-feeds the ticker and overlays river gauges — government warnings reach the public even with no operator on shift.
- **Model data, labelled**: rainfall sparkline/outlook and river discharge series from Open-Meteo, marked `MODEL`. Every panel carries a source chip and sync stamp.
- **War-room chrome**: IST clock, live-connection indicator, monochrome UI palette where color exclusively means signal (red = danger/SOS, amber = warning).

**Ops console (`/admin`)**
- Operator sign-in via Supabase Auth (accounts provisioned by the administrator; no public registration).
- Pending-SOS queue with directions, call links, mark-rescued and reopen.
- Publish / retract advisories to the public ticker in real time.
- Flood report verification (verify / unverify).

---

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in your Supabase URL + anon key
npm run dev
```

> **Do not run `npm run build` while `next dev` is running** — both write `.next`, and the build replaces chunks the dev server still references, crashing it with `Cannot find module './<id>.js'`. For a verification build alongside a live dev server:
> ```bash
> NEXT_DIST_DIR=.next-verify npm run build
> ```

### Supabase checklist

1. **Create a project**, copy Project URL + anon key into `.env.local`.
2. **Run migrations** in the SQL Editor, **in order** (`supabase/migrations/`):

   | Migration | Purpose |
   | --- | --- |
   | `00001_create_tables.sql` | `flood_reports`, `sos_requests`, RLS, storage bucket |
   | `00002_create_advisories.sql` | `advisories` table |
   | `00003_allow_public_updates.sql` | Public "mark rescued" updates |
   | `00004_enable_realtime_and_fixes.sql` | Realtime publications |
   | `00005_harden_policies.sql` | **Required.** Public updates restricted to the `status` column; photo bucket constrained; seeded advisories cleared |
   | `00006_validation_constraints.sql` | **Required.** Server-side CHECK constraints (Kerala bounding box, length/count limits) — client validation alone is bypassable |
   | `00007_admin_policies.sql` | Operator (`authenticated`) policies for the ops console |
   | `00008_push_and_rescue_verification.sql` | **Required.** Revokes `status` writes from anon (public now only *reports* a rescue); adds `push_subscriptions` + `pushed_alerts` |

3. **Realtime**: on by default; verify `flood_reports`, `sos_requests`, `advisories` appear under Database → Replication → `supabase_realtime` (added by `00004`).
4. **Storage**: the `flood-photos` bucket is created by `00001` and constrained by `00005` (5MB, image MIME types, `reports/` prefix). Nothing manual.
5. **Operator accounts**: Authentication → Users → *Add user* for each operator, then **disable public sign-ups** (Authentication → Sign In / Up). The app has no sign-up UI, but open sign-ups would let anyone mint an `authenticated` session and use the operator policies.
6. **Known residual risk** (documented in `00005`): the public can mark any SOS "rescued". Closing it fully means removing the anon update policy and routing all status changes through authenticated operators — a product decision, with the exact SQL commented in `00005`.

Migrations `00005`, `00006` and `00008` are not optional. Without them, any anonymous visitor can rewrite a trapped person's phone number and GPS coordinates, insert junk at arbitrary coordinates, or silently close (and reopen) other people's rescue requests.

> **Note on `00005`:** its `WITH CHECK (status IN ('pending','rescued'))` was effectively a no-op — `sos_status` contains only those two values, so it constrained nothing. `00008` is what actually closes that hole, by revoking the `status` column from `anon` entirely.
>
> **Order matters, and there is no migration-tracking table.** These files are pasted into the SQL editor by hand, so re-running `00005` *after* `00008` would restore the permissive grant and silently reopen the hole. `00005` carries a warning header to that effect. If you ever do re-run it, run `00008` again immediately afterwards.

What `00008` guarantees for the `anon` role on `sos_requests` (verified against PostgreSQL, not just intended):

| Attempt | Result |
| --- | --- |
| `SET rescue_reported_at = now()` on an open, unflagged request | allowed — this is the public "report rescued" action |
| `SET status = 'rescued'` | `permission denied` — the column is not granted |
| `SET phone = …`, `SET latitude = …` | `permission denied` |
| Any update to an already-`rescued` row | blocked by RLS (0 rows) |
| Clearing someone else's flag (`SET rescue_reported_at = NULL`) | blocked by RLS — the flag is **write-once** for the public; only operators can clear it |
| Mass-flagging every open request in one `UPDATE` | capped at one write per row by the same write-once rule |

---

## Push notifications (optional)

Alerts opted-in devices within 25 km when an SOS is filed nearby, plus red/orange official warnings. The app runs fine without them — the consent UI hides itself and `/api/push/*` returns 503.

1. **VAPID keys** — `npx web-push generate-vapid-keys` → `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, plus a `VAPID_SUBJECT` mailto.
2. **Service-role key** — Supabase → Settings → API → `service_role` into `SUPABASE_SERVICE_ROLE_KEY`. **Server-only**: it bypasses RLS, so never give it a `NEXT_PUBLIC_` prefix. `src/lib/push.ts` imports `server-only` so a stray client import fails the build rather than leaking it.
3. **Database webhook** — Supabase → Database → Webhooks → table `sos_requests`, event `INSERT`, `POST https://<host>/api/push/dispatch`, header `x-webhook-secret: <PUSH_WEBHOOK_SECRET>`. Server-triggered on purpose: the alert still goes out if the reporter's phone dies right after submitting.
4. **Alert sweep cron** — `vercel.json` schedules `/api/push/alerts-sweep` every 10 minutes. Any external scheduler works; authenticate with the same `x-webhook-secret`.

**iOS caveat**: Apple only exposes the Push API to sites added to the Home Screen. On iPhone the consent card replaces the enable button with Add-to-Home-Screen instructions — this is a platform limit, not a bug.

**Privacy posture**, deliberate and worth preserving:
- Subscriber coordinates are **rounded to ~1.1 km before they reach the database**. A 25 km radius does not need street-level accuracy.
- Stored data is an opaque push endpoint plus a coarse area — no name, no phone, nothing identifying.
- **Notification payloads never contain a name or phone number.** A push renders on a lock screen anyone holding the phone can read; identifying details appear only after the responder opens the dashboard.
- `push_subscriptions` and `pushed_alerts` have RLS on with **no anon/authenticated policies at all** — reachable only via the service role, and never broadcast over realtime.

---

## Map tiles (OpenStreetMap)

The basemap is OSM's public tile server, used per the [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/):

- **Attribution is mandatory** — "© OpenStreetMap contributors" renders on the map and in the footer. Never remove it.
- Single tile domain (no `{s}` sharding), no retina `{r}` requests, `updateWhenIdle` panning, zoom clamped to 7–18, and the main map is bounded to Kerala — all of which keep tile consumption modest.
- Tiles render in OSM's standard full-color style (the monochrome mandate applies to the UI chrome, not the basemap).
- The tile URL and attribution are env-overridable (`NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION`), so the app does not hard-depend on osm.org.

**Scale math**: a map session loads ~30–60 tiles; 10k users/day during an event is ~500k tiles/day, which exceeds what OSM's donated infrastructure is for and any keyed free tier. If this deploys at real event scale, switch the env vars to a paid keyed provider (MapTiler/Stadia) or self-host PMTiles behind a CDN.

---

## Data sources

Official-first: government data is used wherever a public source exists; model data fills the gaps and is always labelled. Every panel shows a source chip.

| Feed | Source | Chip | Notes |
| --- | --- | --- | --- |
| SOS & flood reports | Crowd + operator verification (Supabase realtime) | `LIVE` | The core of the system |
| Dam levels | **KSDMA daily bulletins** (KSEB + Irrigation PDFs, [sdma.kerala.gov.in](https://sdma.kerala.gov.in/dam-water-level/)) | `KSDMA` | Scraped + PDF-parsed every 30 min; per-dam fallback to rainfall estimate (`EST`) when a dam is missing from the day's bulletin or the parse fails |
| Official alerts | **NDMA SACHET CAP feed** (IMD / Kerala SDMA / CWC) | `Official` | Auto-feeds the ticker, overlays river gauges, and overrides the weather warning banner |
| Rainfall now/forecast | Open-Meteo | `MODEL` | No public IMD API exists for raw forecast series |
| River discharge series | Open-Meteo flood model | `MODEL` | CWC flood *alerts* overlay via SACHET |
| Advisories | Operator-published via ops console | — | Never seed demo bulletins — they render identically to genuine warnings |

**Brittleness warning**: the KSDMA integration scrapes a WordPress page for date-stamped PDF links and parses table text out of PDFs. If KSDMA changes the layout, parsing fails *safe* — affected dams drop to the labelled rainfall estimate, never to silent wrong numbers. Check the `officialCount` field of `/api/dams` when debugging.
