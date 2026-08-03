import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Operator-published advisories, read server-side.
 *
 * The dashboard reads this table straight from the browser (it already ships
 * the Supabase client for the realtime SOS queue). /hotlines does not — it is
 * the page people open on a saturated network mid-event, and pulling in
 * `@supabase/supabase-js` there cost ~70 kB before the advisory text could
 * render. This route trades that for a few kB of `fetch`.
 *
 * Uses the anon key, so RLS applies exactly as it does in the browser.
 */

export const dynamic = "force-dynamic";
// Never cached: an operator publishing "evacuate now" must not sit behind a
// revalidation window.
export const revalidate = 0;

let cached: SupabaseClient<Database> | null = null;

function getClient(): SupabaseClient<Database> | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  cached = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/**
 * `success: false` means the feed was unreachable. An empty `advisories` array
 * with `success: true` means "reachable, nothing published" — the caller
 * renders those two states differently, and must be able to tell them apart.
 */
export async function GET() {
  const supabase = getClient();
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: "Advisory feed is not configured" },
      { status: 503 }
    );
  }

  try {
    const { data, error } = await supabase
      .from("advisories")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, advisories: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Advisory feed unreachable";
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
