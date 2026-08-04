"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

const LocationPickerMap = dynamic(() => import("./LocationPickerMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-44 w-full items-center justify-center rounded-xl border border-surface-700 bg-surface-950 text-xs text-surface-500">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      Loading location map…
    </div>
  ),
});
import type { FloodReport, SosRequest, WaterLevel } from "@/types/database";
import {
  hashDeleteToken,
  isMissingTokenColumn,
  newDeleteToken,
  rememberSubmission,
} from "@/lib/ownership";
import { X, Loader2, Upload, Check, Crosshair } from "lucide-react";

/* ════════════════════════════════════════════════════════════════════════════
   Types
   ════════════════════════════════════════════════════════════════════════════ */

interface ReportModalProps {
  open: boolean;
  /** Tab to show when the modal opens. Defaults to "sos" — the primary action. */
  initialTab?: Tab;
  onClose: () => void;
  onFloodReportCreated: (report: FloodReport) => void;
  onSosCreated: (sos: SosRequest) => void;
}

type Tab = "flood" | "sos";

const WATER_LEVELS: { value: WaterLevel; label: string; steps: number; desc: string }[] = [
  { value: "ankle", label: "Ankle", steps: 1, desc: "Water at ankle height" },
  { value: "knee",  label: "Knee",  steps: 2, desc: "Water at knee height" },
  { value: "waist", label: "Waist", steps: 3, desc: "Water at waist height" },
  { value: "roof",  label: "Roof",  steps: 4, desc: "Water near or above roof" },
];

/** Rising-bar glyph for the water-level picker: 4 steps, filled = severity. */
function LevelGlyph({ steps, active }: { steps: number; active: boolean }) {
  const fillColor =
    steps === 4
      ? "bg-emergency-500"
      : steps === 3
      ? "bg-warning-500"
      : active
      ? "bg-surface-200"
      : "bg-surface-400";
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          style={{ height: `${4 + i * 3}px` }}
          className={`w-1 rounded-sm ${i <= steps ? fillColor : "bg-surface-700"}`}
        />
      ))}
    </span>
  );
}

const NEED_OPTIONS = ["Food", "Water", "Medical", "Rescue"] as const;

/** Anti-spam throttle between submissions, in seconds. */
const COOLDOWN_SECONDS = 30;

/** Bounds that mirror the database columns and keep payloads sane. */
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_NAME_LENGTH = 80;

/** Rejected before compression so a huge file never reaches the browser worker. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/* ════════════════════════════════════════════════════════════════════════════
   GPS helper
   ════════════════════════════════════════════════════════════════════════════ */

function useGeoLocation() {
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setLocating(false);
      },
      (err) => {
        setError(err.message);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  return { lat, lng, locating, error, detect, setLat, setLng };
}

/* ════════════════════════════════════════════════════════════════════════════
   Component
   ════════════════════════════════════════════════════════════════════════════ */

export default function ReportModal({
  open,
  initialTab = "sos",
  onClose,
  onFloodReportCreated,
  onSosCreated,
}: ReportModalProps) {
  /* ── Shared state ─────────────────────────────────────────────────────── */
  const [tab, setTab] = useState<Tab>(initialTab);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Land on the tab the caller asked for each time the dialog opens — the SOS
  // button must always open directly onto the SOS form.
  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setFormError(null);
      setSuccess(false);
    }
  }, [open, initialTab]);

  /* ── Anti-Spam States ─────────────────────────────────────────────────── */
  const [honeypot, setHoneypot] = useState("");
  const [cooldown, setCooldown] = useState(0);

  /* ── Check Active Cooldown ────────────────────────────────────────────── */
  useEffect(() => {
    const last = localStorage.getItem("last_submission_time");
    if (!last) return;
    const startedAt = parseInt(last, 10);
    if (!Number.isFinite(startedAt)) return;

    const diff = Math.floor((Date.now() - startedAt) / 1000);
    if (diff < 0 || diff >= COOLDOWN_SECONDS) return;

    setCooldown(COOLDOWN_SECONDS - diff);
    const interval = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [success, open]);

  /* ── Dialog behaviour: Escape to close, lock background scroll ────────── */
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  /* ── Flood form state ─────────────────────────────────────────────────── */
  const [waterLevel, setWaterLevel] = useState<WaterLevel>("ankle");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const floodGeo = useGeoLocation();
  const floodFileRef = useRef<HTMLInputElement>(null);

  /* ── SOS form state ───────────────────────────────────────────────────── */
  const [sosName, setSosName] = useState("");
  const [sosPhone, setSosPhone] = useState("");
  const [sosPeople, setSosPeople] = useState(1);
  const [sosNeeds, setSosNeeds] = useState<string[]>([]);
  const sosGeo = useGeoLocation();

  /* ── Image handler ────────────────────────────────────────────────────── */
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setFormError("Please choose an image file.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setFormError("That photo is larger than 20MB. Please choose a smaller one.");
      e.target.value = "";
      return;
    }

    setFormError(null);
    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (floodFileRef.current) floodFileRef.current.value = "";
  };

  /* ── Need toggle ──────────────────────────────────────────────────────── */
  const toggleNeed = (need: string) => {
    setSosNeeds((prev) =>
      prev.includes(need) ? prev.filter((n) => n !== need) : [...prev, need]
    );
  };

  /* ── Reset ────────────────────────────────────────────────────────────── */
  const resetForms = () => {
    setWaterLevel("ankle");
    setDescription("");
    clearImage();
    setSosName("");
    setSosPhone("");
    setSosPeople(1);
    setSosNeeds([]);
    setFormError(null);
    setSuccess(false);
  };

  /* ── Close handler ────────────────────────────────────────────────────── */
  const handleClose = () => {
    resetForms();
    onClose();
  };

  /* ── Upload image to Supabase Storage with compression ────────────────── */
  /**
   * Returns an explicit error instead of null so a failed upload can be shown
   * to the reporter rather than silently dropping their photo evidence.
   */
  const uploadImage = async (
    file: File
  ): Promise<{ url: string } | { error: string }> => {
    let uploadFile = file;

    // Apply compression if image is > 500KB
    if (file.size > 500 * 1024) {
      const options = {
        maxSizeMB: 0.45, // Target < 500KB
        maxWidthOrHeight: 1600,
        useWebWorker: true,
      };
      try {
        // Loaded on demand: 21KB gzip that only matters once someone actually
        // attaches a large photo, so it stays off the landing-page bundle.
        const { default: imageCompression } = await import("browser-image-compression");
        uploadFile = await imageCompression(file, options);
      } catch (err) {
        console.error("Image compression failed, uploading original:", err);
      }
    }

    const ext = (uploadFile.name.split(".").pop() ?? "jpg").toLowerCase();
    const path = `reports/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    try {
      const { error } = await supabase.storage
        .from("flood-photos")
        .upload(path, uploadFile, { cacheControl: "3600", upsert: false });

      if (error) {
        console.error("Storage upload error:", error);
        return { error: error.message };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      return { error: msg };
    }

    const { data } = supabase.storage.from("flood-photos").getPublicUrl(path);

    return { url: data.publicUrl };
  };

  /* ══════════════════════════════════════════════════════════════════════════
     Submit: Flood Report
     ══════════════════════════════════════════════════════════════════════════ */

  const submitFloodReport = async () => {
    if (honeypot) {
      // Silently discard spam bot submissions
      setSuccess(true);
      setTimeout(() => handleClose(), 1200);
      return;
    }

    if (cooldown > 0) {
      setFormError(`Please wait ${cooldown}s before submitting again.`);
      return;
    }

    if (floodGeo.lat === null || floodGeo.lng === null) {
      setFormError("Please detect your GPS location first.");
      return;
    }

    if (!isSupabaseConfigured) {
      setFormError("Supabase is not configured yet. Please create a .env.local file with your NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      let imageUrl: string | null = null;
      if (imageFile) {
        const upload = await uploadImage(imageFile);
        if ("error" in upload) {
          setFormError(
            `Photo upload failed: ${upload.error}. Remove the photo to submit the report without it.`
          );
          return;
        }
        imageUrl = upload.url;
      }

      // Ownership token — see src/lib/ownership.ts. Minted before the insert so
      // the hash lands in the same statement as the row, leaving no window in
      // which a report exists unclaimed. Both helpers return null rather than
      // throwing: a browser that cannot mint a token still files its report,
      // it just never gets a remove button.
      const token = newDeleteToken();
      const tokenHash = token ? await hashDeleteToken(token) : null;

      const payload = {
        latitude: floodGeo.lat,
        longitude: floodGeo.lng,
        water_level: waterLevel,
        description: description.trim(),
        image_url: imageUrl,
        verified: false,
      };

      let claimed = Boolean(token && tokenHash);
      let res = await supabase
        .from("flood_reports")
        .insert({ ...payload, delete_token_hash: tokenHash })
        .select()
        .single();

      // Migration 00009 not applied yet — retry without the column rather than
      // lose the report. See isMissingTokenColumn().
      if (isMissingTokenColumn(res.error)) {
        claimed = false;
        res = await supabase.from("flood_reports").insert(payload).select().single();
      }

      const { data, error } = res;

      if (error) {
        setFormError(error.message);
        return;
      }

      // The row is added from the server response, so it carries the real
      // database id. Adding a client-generated row here instead would leave a
      // duplicate once the realtime INSERT arrives, and a permanent ghost card
      // whenever the insert failed.
      if (data) {
        // Before the callback, not after: the dashboard derives ownership by
        // re-reading storage inside it, so the token has to be there already.
        if (claimed && token) {
          rememberSubmission({ id: (data as FloodReport).id, kind: "flood", token });
        }
        onFloodReportCreated(data as FloodReport);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setFormError(`Connection Error: ${msg}. Make sure your Supabase project URL in .env.local is valid and online.`);
      return;
    } finally {
      setSubmitting(false);
    }

    // Set last submission timestamp for cooldown
    localStorage.setItem("last_submission_time", Date.now().toString());

    setSuccess(true);
    setTimeout(() => {
      handleClose();
    }, 1200);
  };

  /* ══════════════════════════════════════════════════════════════════════════
     Submit: SOS Request
     ══════════════════════════════════════════════════════════════════════════ */

  const submitSos = async () => {
    if (honeypot) {
      // Silently discard spam bot submissions
      setSuccess(true);
      setTimeout(() => handleClose(), 1200);
      return;
    }

    if (cooldown > 0) {
      setFormError(`Please wait ${cooldown}s before submitting again.`);
      return;
    }

    if (!sosName.trim()) {
      setFormError("Please enter your name.");
      return;
    }
    if (!sosPhone.trim()) {
      setFormError("Please enter a phone number.");
      return;
    }
    const phoneDigits = sosPhone.replace(/[\s\-+]/g, "");
    if (!/^[6-9]\d{9}$/.test(phoneDigits)) {
      setFormError("Please enter a valid 10-digit Indian mobile number.");
      return;
    }
    if (sosGeo.lat === null || sosGeo.lng === null) {
      setFormError("Please detect your GPS location first.");
      return;
    }

    if (!isSupabaseConfigured) {
      setFormError("Supabase is not configured yet. Please create a .env.local file with your NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      // See the flood path above. Failing to mint a token must never cost
      // someone their SOS, so both helpers degrade to null.
      const token = newDeleteToken();
      const tokenHash = token ? await hashDeleteToken(token) : null;

      const payload = {
        name: sosName.trim(),
        phone: sosPhone.trim(),
        latitude: sosGeo.lat,
        longitude: sosGeo.lng,
        people_count: sosPeople,
        needs: sosNeeds,
        status: "pending" as const,
      };

      let claimed = Boolean(token && tokenHash);
      let res = await supabase
        .from("sos_requests")
        .insert({ ...payload, delete_token_hash: tokenHash })
        .select()
        .single();

      // A missing column must never cost someone their rescue request.
      if (isMissingTokenColumn(res.error)) {
        claimed = false;
        res = await supabase.from("sos_requests").insert(payload).select().single();
      }

      const { data, error } = res;

      if (error) {
        setFormError(error.message);
        return;
      }

      // Added from the server response so the id matches the realtime event —
      // no duplicate card, and no ghost SOS left behind on a failed insert.
      if (data) {
        if (claimed && token) {
          rememberSubmission({ id: (data as SosRequest).id, kind: "sos", token });
        }
        onSosCreated(data as SosRequest);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setFormError(`Connection Error: ${msg}. Make sure your Supabase project URL in .env.local is valid and online.`);
      return;
    } finally {
      setSubmitting(false);
    }

    // Set last submission timestamp for cooldown
    localStorage.setItem("last_submission_time", Date.now().toString());

    setSuccess(true);
    setTimeout(() => {
      handleClose();
    }, 1200);
  };

  /* ── If not open, render nothing ──────────────────────────────────────── */
  if (!open) return null;

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════════════════ */

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center sm:items-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
        className="relative z-10 w-full max-w-lg animate-slide-up rounded-t-2xl border border-surface-700/50 bg-surface-900 shadow-2xl sm:rounded-2xl"
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-surface-800 px-5 py-4">
          <h2
            id="report-modal-title"
            className="text-base font-bold uppercase tracking-wider text-surface-100"
          >
            Report Incident
          </h2>
          <button
            onClick={handleClose}
            aria-label="Close report dialog"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-500 transition hover:bg-surface-800 hover:text-surface-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Tab switcher ─────────────────────────────────────────────── */}
        <div className="flex border-b border-surface-800">
          <button
            onClick={() => { setTab("flood"); setFormError(null); setSuccess(false); }}
            className={`flex flex-1 items-center justify-center py-3 text-sm font-semibold uppercase tracking-wider transition ${
              tab === "flood"
                ? "border-b-2 border-surface-200 text-surface-100"
                : "text-surface-500 hover:text-surface-300"
            }`}
          >
            Flood Report
          </button>
          <button
            onClick={() => { setTab("sos"); setFormError(null); setSuccess(false); }}
            className={`flex flex-1 items-center justify-center py-3 text-sm font-semibold uppercase tracking-wider transition ${
              tab === "sos"
                ? "border-b-2 border-emergency-500 text-emergency-400"
                : "text-surface-500 hover:text-surface-300"
            }`}
          >
            SOS Report
          </button>
        </div>

        {/* ── Form body ────────────────────────────────────────────────── */}
        <div className="max-h-[60vh] overflow-y-auto px-5 py-5">
          {/* ── Success state ────────────────────────────────────────── */}
          {success ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-surface-600 bg-surface-800">
                <Check className="h-7 w-7 text-surface-100" />
              </div>
              <p className="text-lg font-bold text-surface-100">
                {tab === "flood" ? "Flood Report Submitted" : "SOS Request Sent"}
              </p>
              <p className="text-sm text-surface-400">
                {tab === "flood"
                  ? "Thank you! Your report helps coordinate relief."
                  : "Help is on the way. Stay safe!"}
              </p>
              {/* Sets the "this browser" expectation now, so losing the token
                  later is understood rather than surprising. Deliberately short
                  and secondary — nobody in a flood needs a lecture about
                  browser storage. */}
              <p className="text-xs text-surface-500">
                You can remove this from this browser.
              </p>
            </div>
          ) : tab === "flood" ? (
            /* ══════════════════════════════════════════════════════════
               TAB 1: FLOOD REPORT
               ══════════════════════════════════════════════════════════ */
            <div className="space-y-5">
              {/* Anti-spam honeypot field */}
              <input
                type="text"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                style={{ display: "none" }}
                tabIndex={-1}
                autoComplete="off"
              />

              {/* Water level radios */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-surface-200">
                  Water Level
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {WATER_LEVELS.map((wl) => (
                    <button
                      key={wl.value}
                      type="button"
                      onClick={() => setWaterLevel(wl.value)}
                      className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
                        waterLevel === wl.value
                          ? "border-surface-300 bg-surface-800 text-surface-100"
                          : "border-surface-700 bg-surface-850 text-surface-400 hover:border-surface-600 hover:text-surface-300"
                      }`}
                    >
                      <LevelGlyph steps={wl.steps} active={waterLevel === wl.value} />
                      <span className="text-sm font-semibold">{wl.label}</span>
                      <span className="text-[11px] opacity-70">{wl.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label htmlFor="report-description" className="mb-2 block text-sm font-semibold text-surface-200">
                  Description
                </label>
                <textarea
                  id="report-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={MAX_DESCRIPTION_LENGTH}
                  placeholder="Describe the flooding situation…"
                  className="w-full resize-none rounded-lg border border-surface-700 bg-surface-850 px-3 py-2.5 text-sm text-surface-200 placeholder-surface-600 outline-none transition focus:border-surface-400"
                />
              </div>

              {/* Image upload */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-surface-200">
                  Photo (optional)
                </label>
                {imagePreview ? (
                  <div className="relative">
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="h-32 w-full rounded-lg border border-surface-700 object-cover"
                    />
                    <button
                      type="button"
                      onClick={clearImage}
                      aria-label="Remove photo"
                      className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => floodFileRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-surface-700 py-6 text-sm text-surface-500 transition hover:border-surface-500 hover:text-surface-300"
                  >
                    <Upload className="h-4 w-4" />
                    Click to upload a photo
                  </button>
                )}
                {/* No `capture` attribute — it forces the camera on mobile and
                    blocks picking an already-taken photo from the gallery. */}
                <input
                  ref={floodFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageChange}
                />
              </div>

              {/* GPS detection */}
              <GpsDetector geo={floodGeo} />
            </div>
          ) : (
            /* ══════════════════════════════════════════════════════════
               TAB 2: SOS REQUEST
               ══════════════════════════════════════════════════════════ */
            <div className="space-y-5">
              {/* Anti-spam honeypot field */}
              <input
                type="text"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                style={{ display: "none" }}
                tabIndex={-1}
                autoComplete="off"
              />

              {/* Name */}
              <div>
                <label htmlFor="sos-name" className="mb-2 block text-sm font-semibold text-surface-200">
                  Your Name
                </label>
                <input
                  id="sos-name"
                  type="text"
                  value={sosName}
                  onChange={(e) => setSosName(e.target.value)}
                  maxLength={MAX_NAME_LENGTH}
                  autoComplete="name"
                  placeholder="Full name"
                  className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2.5 text-sm text-surface-200 placeholder-surface-600 outline-none transition focus:border-surface-400"
                />
              </div>

              {/* Phone */}
              <div>
                <label htmlFor="sos-phone" className="mb-2 block text-sm font-semibold text-surface-200">
                  Phone Number
                </label>
                <input
                  id="sos-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={20}
                  value={sosPhone}
                  onChange={(e) => setSosPhone(e.target.value)}
                  placeholder="+91 XXXXX XXXXX"
                  className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2.5 font-mono text-sm text-surface-200 placeholder-surface-600 outline-none transition focus:border-surface-400"
                />
              </div>

              {/* People count */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-surface-200">
                  Number of Trapped People
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label="One fewer person"
                    onClick={() => setSosPeople((p) => Math.max(1, p - 1))}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-surface-700 bg-surface-850 text-lg font-bold text-surface-300 transition hover:bg-surface-800"
                  >
                    −
                  </button>
                  <span
                    aria-live="polite"
                    className="w-12 text-center text-xl font-bold tabular-nums text-surface-100"
                  >
                    {sosPeople}
                  </span>
                  <button
                    type="button"
                    aria-label="One more person"
                    onClick={() => setSosPeople((p) => p + 1)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-surface-700 bg-surface-850 text-lg font-bold text-surface-300 transition hover:bg-surface-800"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Needs checkboxes */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-surface-200">
                  What do you need?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {NEED_OPTIONS.map((need) => {
                    const active = sosNeeds.includes(need);
                    return (
                      <button
                        key={need}
                        type="button"
                        onClick={() => toggleNeed(need)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                          active
                            ? "border-surface-300 bg-surface-800 text-surface-100"
                            : "border-surface-700 bg-surface-850 text-surface-400 hover:border-surface-600 hover:text-surface-300"
                        }`}
                      >
                        <div
                          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                            active
                              ? "border-surface-200 bg-surface-200"
                              : "border-surface-600 bg-surface-800"
                          }`}
                        >
                          {active && <Check className="h-3 w-3 text-surface-950" />}
                        </div>
                        {need}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* GPS detection */}
              <GpsDetector geo={sosGeo} />
            </div>
          )}
        </div>

        {/* ── Error banner ─────────────────────────────────────────────── */}
        {formError && (
          <div className="mx-5 mb-3 rounded-lg border border-emergency-700/50 bg-emergency-950/60 px-3 py-2 text-xs text-emergency-300">
            {formError}
          </div>
        )}

        {/* ── Submit footer ────────────────────────────────────────────── */}
        {!success && (
          <div className="border-t border-surface-800 px-5 py-4">
            <button
              onClick={tab === "flood" ? submitFloodReport : submitSos}
              disabled={submitting}
              className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold uppercase tracking-wider transition disabled:opacity-60 ${
                tab === "flood"
                  ? "bg-surface-200 text-surface-950 hover:bg-surface-50"
                  : "bg-emergency-600 text-white hover:bg-emergency-500 active:bg-emergency-700"
              }`}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : tab === "flood" ? (
                "Submit Flood Report"
              ) : (
                "Send SOS Request"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   GPS Detector sub-component
   ════════════════════════════════════════════════════════════════════════════ */

function GpsDetector({
  geo,
}: {
  geo: ReturnType<typeof useGeoLocation>;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-surface-200">
          Location & GPS Coordinates
        </label>
        <button
          type="button"
          onClick={geo.detect}
          disabled={geo.locating}
          className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-surface-300 hover:text-surface-100 disabled:opacity-60 transition"
        >
          {geo.locating ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Detecting…
            </>
          ) : (
            <>
              <Crosshair className="h-3 w-3" />
              {geo.lat !== null ? "Re-detect GPS" : "Auto-detect GPS"}
            </>
          )}
        </button>
      </div>

      {/* Mini Interactive Map Location Picker */}
      <LocationPickerMap
        lat={geo.lat}
        lng={geo.lng}
        onChange={(newLat, newLng) => {
          geo.setLat(newLat);
          geo.setLng(newLng);
        }}
      />

      {geo.error && (
        <p className="text-xs text-emergency-400 font-medium">
          Location error: {geo.error}
        </p>
      )}
    </div>
  );
}
