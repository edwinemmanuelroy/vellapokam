"use client";

/**
 * Ops Console — the operator side of the war room.
 *
 * Operators sign in with Supabase Auth accounts (created by an admin in the
 * Supabase dashboard; public sign-ups must be disabled there). Once signed in,
 * requests run as the `authenticated` role, which migrations 00001/00002/00007
 * allow to: publish/retract advisories, verify flood reports, and update SOS
 * requests.
 */

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import type {
  Advisory,
  AdvisoryType,
  FloodReport,
  SosRequest,
  WithdrawnKind,
  WithdrawnSubmission,
} from "@/types/database";
import { buildDirectionsUrl, formatRelativeTime } from "@/lib/format";
import { Loader2 } from "lucide-react";

/* ── Shared micro-styles (mirrors the dashboard's mono language) ─────────── */

const inputClass =
  "w-full rounded-sm border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-200 placeholder-surface-600 outline-none transition focus:border-surface-400";

const buttonClass =
  "rounded-sm border border-surface-600 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-surface-200 transition hover:bg-surface-800 disabled:opacity-50";

const ADVISORY_TYPES: { value: AdvisoryType; label: string; classes: string }[] = [
  { value: "critical", label: "Critical", classes: "text-emergency-400 border-emergency-600/50" },
  { value: "warning", label: "Warning", classes: "text-warning-400 border-warning-600/50" },
  { value: "info", label: "Info", classes: "text-surface-400 border-surface-700" },
];

function typeClasses(type: AdvisoryType): string {
  return ADVISORY_TYPES.find((t) => t.value === type)?.classes ?? "text-surface-400 border-surface-700";
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <h2 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-surface-300">
      {title}
      {count !== undefined && (
        <span className="font-mono text-surface-500">{count}</span>
      )}
    </h2>
  );
}

/**
 * Two-step confirm, matching the dashboard's inline pattern.
 *
 * Every other control on this page fires immediately, which is fine for
 * reversible things like Verify or Reopen. Removal is not reversible from here,
 * so it gets the guard.
 */
function ConfirmButton({
  label,
  question,
  onConfirm,
}: {
  label: string;
  question: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="rounded-sm px-2 py-2.5 text-[11px] font-bold uppercase tracking-wider text-surface-500 transition hover:text-surface-200"
      >
        {label}
      </button>
    );
  }

  return (
    <span className="flex flex-1 flex-wrap items-center gap-1.5">
      <span className="flex-1 text-[10px] text-surface-400">{question}</span>
      <button
        onClick={() => {
          setConfirming(false);
          void onConfirm();
        }}
        className="rounded-sm border border-emergency-600/60 px-2.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-emergency-300 transition hover:bg-emergency-950/60"
      >
        Yes, remove
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="rounded-sm px-2 py-2.5 text-[10px] font-bold uppercase tracking-wider text-surface-500 transition hover:text-surface-300"
      >
        Cancel
      </button>
    </span>
  );
}

/* ── Login screen ────────────────────────────────────────────────────────── */

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      setError("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) setError(authError.message);
    // Success: the onAuthStateChange listener in the page swaps to the console.
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="card-glass w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-base font-bold uppercase tracking-wider text-surface-50">
            Ops Console
          </h1>
          <p className="mt-1 text-xs text-surface-500">
            Operator sign-in. Accounts are provisioned by the administrator — there is
            no public registration.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="ops-email" className="mb-1 block text-xs font-semibold text-surface-300">
              Email
            </label>
            <input
              id="ops-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="ops-password" className="mb-1 block text-xs font-semibold text-surface-300">
              Password
            </label>
            <input
              id="ops-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {error && (
          <p className="rounded-sm border border-emergency-700/50 bg-emergency-950/50 px-3 py-2 text-xs text-emergency-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-sm bg-surface-200 px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-surface-950 transition hover:bg-surface-50 disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign In
        </button>

        <Link
          href="/"
          className="block text-center font-mono text-[10px] uppercase tracking-widest text-surface-600 hover:text-surface-300"
        >
          ← Back to dashboard
        </Link>
      </form>
    </div>
  );
}

/* ── Console ─────────────────────────────────────────────────────────────── */

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  /* Data */
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [sosRequests, setSosRequests] = useState<SosRequest[]>([]);
  const [reports, setReports] = useState<FloodReport[]>([]);
  const [withdrawn, setWithdrawn] = useState<WithdrawnSubmission[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  /* Advisory composer */
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [advType, setAdvType] = useState<AdvisoryType>("info");
  const [publishing, setPublishing] = useState(false);

  /* ── Auth wiring ──────────────────────────────────────────────────────── */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  /* ── Data fetch + realtime (only while signed in) ─────────────────────── */
  /**
   * The withdrawal log. Operator-readable only, and deliberately not in the
   * realtime publication — it holds the details of people who asked to be taken
   * off a public page, so it is fetched explicitly rather than broadcast.
   */
  const fetchWithdrawn = useCallback(async () => {
    const { data, error } = await supabase
      .from("withdrawn_submissions")
      .select("*")
      .order("withdrawn_at", { ascending: false })
      .limit(100);
    if (!error && data) setWithdrawn(data as WithdrawnSubmission[]);
  }, []);

  const fetchEverything = useCallback(async () => {
    setLoadingData(true);
    const [advRes, sosRes, repRes] = await Promise.all([
      supabase.from("advisories").select("*").order("created_at", { ascending: false }),
      supabase.from("sos_requests").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("flood_reports").select("*").order("created_at", { ascending: false }).limit(200),
    ]);
    if (advRes.data) setAdvisories(advRes.data as Advisory[]);
    if (sosRes.data) setSosRequests(sosRes.data as SosRequest[]);
    if (repRes.data) setReports(repRes.data as FloodReport[]);
    const firstError = advRes.error ?? sosRes.error ?? repRes.error;
    setActionError(firstError ? firstError.message : null);
    setLoadingData(false);
  }, []);

  useEffect(() => {
    if (!session) return;
    fetchEverything();
    fetchWithdrawn();

    const channel = supabase
      .channel("admin-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sos_requests" }, () => fetchEverything())
      .on("postgres_changes", { event: "*", schema: "public", table: "flood_reports" }, () => fetchEverything())
      .on("postgres_changes", { event: "*", schema: "public", table: "advisories" }, () => fetchEverything())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, fetchEverything, fetchWithdrawn]);

  /* ── Actions ──────────────────────────────────────────────────────────── */
  const publishAdvisory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) return;
    setPublishing(true);
    setActionError(null);
    const { data, error } = await supabase
      .from("advisories")
      .insert({ title: title.trim(), message: message.trim(), type: advType })
      .select()
      .single();
    if (error) {
      setActionError(`Publish failed: ${error.message}`);
    } else if (data) {
      setAdvisories((prev) => [data as Advisory, ...prev]);
      setTitle("");
      setMessage("");
      setAdvType("info");
    }
    setPublishing(false);
  };

  const deleteAdvisory = async (id: string) => {
    setActionError(null);
    const { error } = await supabase.from("advisories").delete().eq("id", id);
    if (error) {
      setActionError(`Retract failed: ${error.message}`);
    } else {
      setAdvisories((prev) => prev.filter((a) => a.id !== id));
    }
  };

  /**
   * Operators are the only role that can move `status` (migration 00008).
   * Confirming also clears the public report flag so the card stops showing
   * as awaiting review.
   */
  const setSosStatus = async (id: string, status: "pending" | "rescued") => {
    setActionError(null);
    // Clearing the flag either way: confirming resolves the report, and
    // reopening means the report was wrong.
    const { error } = await supabase
      .from("sos_requests")
      .update({ status, rescue_reported_at: null })
      .eq("id", id);
    if (error) {
      setActionError(`SOS update failed: ${error.message}`);
    } else {
      setSosRequests((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status, rescue_reported_at: null } : s))
      );
    }
  };

  /** Reject a public rescue report without closing the request. */
  const dismissRescueReport = async (id: string) => {
    setActionError(null);
    const { error } = await supabase
      .from("sos_requests")
      .update({ rescue_reported_at: null })
      .eq("id", id);
    if (error) {
      setActionError(`Could not dismiss the report: ${error.message}`);
    } else {
      setSosRequests((prev) =>
        prev.map((s) => (s.id === id ? { ...s, rescue_reported_at: null } : s))
      );
    }
  };

  /**
   * Take a submission off the public dashboard on someone's behalf.
   *
   * This is the safety valve for the one failure the token design cannot avoid:
   * with no accounts, clearing site data loses the withdrawal token forever.
   * Without a human fallback there would be no way at all to get a phone number
   * taken down.
   *
   * The row moves to `withdrawn_submissions` rather than being destroyed, so a
   * removal is still auditable, and it is a real DELETE from the public table so
   * every open dashboard drops the card via realtime.
   */
  const withdrawSubmission = async (kind: WithdrawnKind, id: string) => {
    setActionError(null);
    const { data, error } = await supabase.rpc("withdraw_submission", {
      p_kind: kind,
      p_id: id,
      // No token: the operator's authenticated session is the authorisation.
      p_token: null,
    });

    if (error) {
      setActionError(`Removal failed: ${error.message}`);
      return;
    }
    if (data !== true) {
      setActionError("Removal failed — that row was already gone.");
    }
    // Realtime refreshes the lists either way; patch locally so the card goes
    // immediately rather than a round-trip later.
    if (kind === "sos") {
      setSosRequests((prev) => prev.filter((s) => s.id !== id));
    } else {
      setReports((prev) => prev.filter((r) => r.id !== id));
    }
    fetchWithdrawn();
  };

  const setReportVerified = async (id: string, verified: boolean) => {
    setActionError(null);
    const { error } = await supabase.from("flood_reports").update({ verified }).eq("id", id);
    if (error) {
      setActionError(`Verification update failed: ${error.message}`);
    } else {
      setReports((prev) => prev.map((r) => (r.id === id ? { ...r, verified } : r)));
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  /* ── Render ───────────────────────────────────────────────────────────── */
  if (!authReady) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center text-surface-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <span className="text-sm">Checking session…</span>
      </div>
    );
  }

  if (!session) {
    return <LoginForm />;
  }

  // Requests the public has reported as rescued need a human decision, so they
  // sort to the top of the queue.
  const pendingSos = sosRequests
    .filter((s) => s.status === "pending")
    .sort(
      (a, b) =>
        (a.rescue_reported_at ? 0 : 1) - (b.rescue_reported_at ? 0 : 1)
    );
  const rescuedSos = sosRequests.filter((s) => s.status === "rescued");
  const awaitingConfirmation = pendingSos.filter((s) => s.rescue_reported_at).length;
  const unverifiedReports = reports.filter((r) => !r.verified);
  const verifiedReports = reports.filter((r) => r.verified);

  return (
    <main className="mx-auto max-w-[1536px] space-y-4 px-4 py-4 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="flex flex-col gap-3 border-b border-surface-800 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-bold uppercase tracking-wider text-surface-50">
            Ops Console
          </h1>
          <p className="text-xs text-surface-500">
            Advisories · SOS queue · report verification
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-surface-500">{session.user.email}</span>
          <Link
            href="/"
            className="rounded-sm px-2 py-2.5 font-mono text-[10px] font-bold uppercase tracking-widest text-surface-500 hover:text-surface-200"
          >
            ← Dashboard
          </Link>
          <button onClick={signOut} className={buttonClass}>
            Sign Out
          </button>
        </div>
      </header>

      {actionError && (
        <div className="rounded-sm border border-emergency-700/50 bg-emergency-950/50 px-3 py-2 text-xs text-emergency-300">
          {actionError}
        </div>
      )}

      {loadingData ? (
        <div className="flex h-40 items-center justify-center text-surface-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          <span className="text-sm">Loading operational data…</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* ── Column 1: Advisories ─────────────────────────────────────── */}
          <section className="space-y-3">
            <SectionHeader title="Publish Advisory" />
            <form onSubmit={publishAdvisory} className="card-glass space-y-3 p-4">
              <p className="text-[10px] leading-relaxed text-surface-500">
                Publishes instantly to the public ticker. Only relay information
                confirmed by KSDMA / IMD / district authorities — never publish
                unverified reports as advisories.
              </p>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                required
                placeholder="Source / title (e.g. KSDMA)"
                className={inputClass}
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={1000}
                required
                rows={3}
                placeholder="Advisory text…"
                className={`${inputClass} resize-none`}
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1">
                  {ADVISORY_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setAdvType(t.value)}
                      className={`rounded-sm border px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition ${
                        advType === t.value ? t.classes : "border-surface-800 text-surface-600 hover:text-surface-400"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={publishing}
                  className="flex items-center gap-1.5 rounded-sm bg-surface-200 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-surface-950 transition hover:bg-surface-50 disabled:opacity-60"
                >
                  {publishing && <Loader2 className="h-3 w-3 animate-spin" />}
                  Publish
                </button>
              </div>
            </form>

            <SectionHeader title="Live Advisories" count={advisories.length} />
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {advisories.length === 0 ? (
                <p className="rounded-lg border border-dashed border-surface-800 py-6 text-center text-xs text-surface-500">
                  Nothing published.
                </p>
              ) : (
                advisories.map((a) => (
                  <div key={a.id} className="card-glass space-y-1.5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${typeClasses(a.type)}`}
                      >
                        {a.title}
                      </span>
                      <button
                        onClick={() => deleteAdvisory(a.id)}
                        className="rounded-sm px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-surface-600 transition hover:text-emergency-400"
                      >
                        Retract
                      </button>
                    </div>
                    <p className="text-xs leading-relaxed text-surface-300">{a.message}</p>
                    <p className="font-mono text-[9px] text-surface-600">{formatRelativeTime(a.created_at)}</p>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ── Column 2: SOS queue ──────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <SectionHeader title="Pending SOS" count={pendingSos.length} />
              {awaitingConfirmation > 0 && (
                <span className="rounded-sm border border-warning-600/50 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-warning-400">
                  {awaitingConfirmation} awaiting confirmation
                </span>
              )}
            </div>
            <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
              {pendingSos.length === 0 ? (
                <p className="rounded-lg border border-dashed border-surface-800 py-6 text-center text-xs text-surface-500">
                  Queue clear.
                </p>
              ) : (
                pendingSos.map((sos) => (
                  <div
                    key={sos.id}
                    className={`card-glass relative overflow-hidden space-y-2 p-3 ${
                      sos.rescue_reported_at ? "border-warning-700/60" : ""
                    }`}
                  >
                    <div
                      className={`absolute inset-y-0 left-0 w-0.5 ${
                        sos.rescue_reported_at
                          ? "bg-warning-500"
                          : "animate-pulse-emergency bg-emergency-500"
                      }`}
                    />
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold text-surface-100">{sos.name}</span>
                      <span className="font-mono text-[9px] text-surface-500">
                        {formatRelativeTime(sos.created_at)}
                      </span>
                    </div>

                    {sos.rescue_reported_at && (
                      <div className="rounded-sm border border-warning-700/40 bg-warning-950/20 px-2 py-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-warning-300">
                          Rescue reported {formatRelativeTime(sos.rescue_reported_at)}
                        </p>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-warning-200/80">
                          Reported by a member of the public — verify before closing.
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px] text-surface-300">
                      <a href={`tel:${sos.phone}`} className="inline-block truncate rounded-sm py-2 hover:underline">{sos.phone}</a>
                      <span>{sos.people_count} people</span>
                    </div>
                    {sos.needs.length > 0 && (
                      <p className="text-[10px] uppercase tracking-wider text-surface-500">
                        {sos.needs.join(" · ")}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5 border-t border-surface-800 pt-2">
                      <a
                        href={buildDirectionsUrl(sos.latitude, sos.longitude)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonClass}
                      >
                        Directions
                      </a>
                      <button onClick={() => setSosStatus(sos.id, "rescued")} className={buttonClass}>
                        {sos.rescue_reported_at ? "Confirm Rescued" : "Mark Rescued"}
                      </button>
                      {sos.rescue_reported_at && (
                        <button
                          onClick={() => dismissRescueReport(sos.id)}
                          className={buttonClass}
                          title="Reject the report and keep this request open"
                        >
                          Dismiss Report
                        </button>
                      )}
                      {/* For someone who lost their device token and asked to be
                          taken down. Archived, not destroyed. */}
                      <ConfirmButton
                        label="Remove"
                        question="Take this off the public dashboard?"
                        onConfirm={() => withdrawSubmission("sos", sos.id)}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>

            <SectionHeader title="Rescued" count={rescuedSos.length} />
            <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
              {rescuedSos.map((sos) => (
                <div key={sos.id} className="card-glass flex items-center justify-between gap-2 p-3 opacity-60">
                  <div>
                    <span className="block text-xs font-bold text-surface-200">{sos.name}</span>
                    <span className="font-mono text-[9px] text-surface-500">
                      {sos.people_count} people · {formatRelativeTime(sos.created_at)}
                    </span>
                  </div>
                  {/* Undo path for mis-clicks — a wrongly closed SOS is a stranded family. */}
                  <button onClick={() => setSosStatus(sos.id, "pending")} className={buttonClass}>
                    Reopen
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* ── Column 3: Report verification ────────────────────────────── */}
          <section className="space-y-3">
            <SectionHeader title="Unverified Reports" count={unverifiedReports.length} />
            <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
              {unverifiedReports.length === 0 ? (
                <p className="rounded-lg border border-dashed border-surface-800 py-6 text-center text-xs text-surface-500">
                  Nothing awaiting review.
                </p>
              ) : (
                unverifiedReports.map((r) => (
                  <div key={r.id} className="card-glass space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold capitalize text-surface-100">
                        {r.water_level} level
                      </span>
                      <span className="font-mono text-[9px] text-surface-500">
                        {formatRelativeTime(r.created_at)}
                      </span>
                    </div>
                    {r.description && (
                      <p className="text-xs leading-relaxed text-surface-300">{r.description}</p>
                    )}
                    {r.image_url && (
                      <img
                        src={r.image_url}
                        alt="Flood report photo"
                        className="h-24 w-full rounded border border-surface-700 object-cover"
                      />
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-800 pt-2">
                      <span className="font-mono text-[9px] text-surface-500">
                        {r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}
                      </span>
                      <span className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
                        <button onClick={() => setReportVerified(r.id, true)} className={buttonClass}>
                          Verify
                        </button>
                        <ConfirmButton
                          label="Remove"
                          question="Take this off the public dashboard?"
                          onConfirm={() => withdrawSubmission("flood", r.id)}
                        />
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <SectionHeader title="Verified" count={verifiedReports.length} />
            <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
              {verifiedReports.map((r) => (
                <div key={r.id} className="card-glass flex items-center justify-between gap-2 p-3 opacity-60">
                  <span className="text-xs font-bold capitalize text-surface-200">
                    {r.water_level} level · {formatRelativeTime(r.created_at)}
                  </span>
                  <button onClick={() => setReportVerified(r.id, false)} className={buttonClass}>
                    Unverify
                  </button>
                </div>
              ))}
            </div>

            {/* ── Withdrawal log ──────────────────────────────────────────
                Removals leave the public tables but not the record. Operators
                only — this holds the details of people who asked to be taken
                off a public page, so it is never exposed to anon. */}
            <SectionHeader title="Withdrawn" count={withdrawn.length} />
            <p className="text-[10px] leading-relaxed text-surface-500">
              Taken off the dashboard by their author, or by an operator. Kept
              here as a record; no longer public.
            </p>
            <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
              {withdrawn.length === 0 ? (
                <p className="rounded-lg border border-dashed border-surface-800 py-6 text-center text-xs text-surface-500">
                  Nothing withdrawn yet.
                </p>
              ) : (
                withdrawn.map((w) => {
                  const p = w.payload as Record<string, string | number | null>;
                  const label =
                    w.kind === "sos"
                      ? String(p.name ?? "SOS request")
                      : `${String(p.water_level ?? "flood")} level report`;
                  return (
                    <div key={w.id} className="card-glass space-y-1 p-3 opacity-70">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-bold text-surface-200">
                          {label}
                        </span>
                        <span className="source-chip flex-shrink-0">
                          {w.withdrawn_by === "author" ? "By author" : "By operator"}
                        </span>
                      </div>
                      <span className="block font-mono text-[9px] text-surface-500">
                        {w.kind === "sos" ? "SOS" : "Report"} ·{" "}
                        {formatRelativeTime(w.withdrawn_at)}
                        {p.phone ? ` · ${String(p.phone)}` : ""}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
