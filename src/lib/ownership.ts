/**
 * Device-held proof of authorship, so people can take down their own posts
 * without an account.
 *
 * There are no signups in this app, so the database cannot tell the person who
 * filed an SOS from any other anonymous visitor. The substitute is a capability
 * token: on submit the browser mints 256 bits of entropy, keeps it here, and
 * stores only its SHA-256 on the row. Presenting the token is what proves
 * authorship — see `withdraw_submission()` in migration 00009.
 *
 * The honest consequence, which the UI states plainly rather than hides:
 * clearing site data, switching browser, or posting from another device loses
 * the token for good. An operator removal in /admin is the only fallback.
 *
 * Nothing in here may ever throw. Every function is called on the submit path
 * of an emergency form, and a failure to mint a token must cost someone a
 * delete button, never their SOS. Safari in private mode throws on `setItem`,
 * and a hand-edited or truncated value must not take down the dashboard.
 */

export type OwnedKind = "sos" | "flood";

export interface OwnedEntry {
  /** Row id in `sos_requests` or `flood_reports`. */
  id: string;
  kind: OwnedKind;
  /** The plaintext capability token. Never leaves this device except to
   *  `withdraw_submission()`, which compares its hash. */
  token: string;
  /** Creation time, used only to decide what to drop when over MAX_ENTRIES. */
  at: number;
}

const KEY = "my_submissions";

/**
 * Newest entries kept when the list overflows.
 *
 * There is deliberately no expiry. An entry costs a few hundred bytes; losing
 * one costs someone the ability to take their own name, phone number and
 * location off a public page. That trade never favours a TTL.
 */
const MAX_ENTRIES = 50;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** Every read funnels through here, so one corrupt value cannot break a render. */
export function readOwned(): OwnedEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is OwnedEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as OwnedEntry).id === "string" &&
        typeof (e as OwnedEntry).token === "string" &&
        ((e as OwnedEntry).kind === "sos" || (e as OwnedEntry).kind === "flood")
    );
  } catch {
    return [];
  }
}

function writeOwned(entries: OwnedEntry[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Private mode, or the quota is full. The submission still stands; the
    // person just will not see a remove button.
  }
}

/**
 * 32 bytes of CSPRNG entropy as base64url.
 *
 * Returns null when `crypto.getRandomValues` is unavailable rather than falling
 * back to `Math.random()` — a guessable token is worse than no token at all,
 * because it would let strangers withdraw other people's requests.
 */
export function newDeleteToken(): string | null {
  try {
    if (typeof crypto === "undefined" || !crypto.getRandomValues) return null;
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  } catch {
    return null;
  }
}

/**
 * SHA-256 of a token, lowercase hex — the only form that leaves the device.
 *
 * `crypto.subtle` needs a secure context. The app already requires one for
 * service workers and Web Push, but this returns null rather than throwing so
 * an insecure origin degrades to "no remove button" instead of a failed submit.
 */
export async function hashDeleteToken(token: string): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(token)
    );
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/** Record a token for a row this device just created. */
export function rememberSubmission(entry: Omit<OwnedEntry, "at">): void {
  const existing = readOwned().filter((e) => e.id !== entry.id);
  writeOwned([...existing, { ...entry, at: Date.now() }]);
}

/**
 * Drop a token.
 *
 * Only ever called on positive evidence that the row is gone — our own
 * withdrawal succeeded, or a realtime DELETE arrived. Never call this because a
 * row is missing from the feed: `fetchAll` is capped at 100 rows and the lists
 * are district-filterable, so absence proves nothing, and pruning on it would
 * destroy delete capability during exactly the busy event where the cap bites.
 */
export function forgetSubmission(id: string): void {
  const remaining = readOwned().filter((e) => e.id !== id);
  writeOwned(remaining);
}

export function ownedTokenFor(id: string): string | null {
  return readOwned().find((e) => e.id === id)?.token ?? null;
}

/** Ids this device can withdraw — drives which cards show a remove button. */
export function ownedIdSet(): Set<string> {
  return new Set(readOwned().map((e) => e.id));
}

/**
 * True when an insert failed only because `delete_token_hash` does not exist.
 *
 * This app has no migration-tracking table — migrations are pasted into the
 * Supabase SQL editor by hand — so the code can very plausibly reach production
 * before 00009 does. Without a fallback, that ordering would make every SOS
 * and every flood report fail to submit. A missing delete button is an
 * acceptable degradation; a rejected SOS is not.
 *
 * Safe to delete once 00009 is applied to every environment.
 */
export function isMissingTokenColumn(
  error: { code?: string; message?: string } | null
): boolean {
  if (!error) return false;
  // PGRST204 = "column not found in schema cache".
  return error.code === "PGRST204" || /delete_token_hash/.test(error.message ?? "");
}
