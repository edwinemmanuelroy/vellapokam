"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import imageCompression from "browser-image-compression";
import { supabase } from "@/lib/supabaseClient";
import type { FloodReport, SosRequest, WaterLevel } from "@/types/database";
import {
  X,
  Droplets,
  LifeBuoy,
  MapPin,
  Loader2,
  Camera,
  Upload,
  Check,
  AlertTriangle,
  Waves,
  Users,
  Phone,
  User,
  Crosshair,
} from "lucide-react";

/* ════════════════════════════════════════════════════════════════════════════
   Types
   ════════════════════════════════════════════════════════════════════════════ */

interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  onFloodReportCreated: (report: FloodReport) => void;
  onSosCreated: (sos: SosRequest) => void;
}

type Tab = "flood" | "sos";

const WATER_LEVELS: { value: WaterLevel; label: string; icon: string; desc: string }[] = [
  { value: "ankle", label: "Ankle",  icon: "🌊", desc: "Water at ankle height" },
  { value: "knee",  label: "Knee",   icon: "🌊🌊", desc: "Water at knee height" },
  { value: "waist", label: "Waist",  icon: "🌊🌊🌊", desc: "Water at waist height" },
  { value: "roof",  label: "Roof",   icon: "🏠🌊", desc: "Water near or above roof" },
];

const NEED_OPTIONS = ["Food", "Water", "Medical", "Rescue"] as const;

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
  onClose,
  onFloodReportCreated,
  onSosCreated,
}: ReportModalProps) {
  /* ── Shared state ─────────────────────────────────────────────────────── */
  const [tab, setTab] = useState<Tab>("flood");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* ── Anti-Spam States ─────────────────────────────────────────────────── */
  const [honeypot, setHoneypot] = useState("");
  const [cooldown, setCooldown] = useState(0);

  /* ── Check Active Cooldown ────────────────────────────────────────────── */
  useEffect(() => {
    const last = localStorage.getItem("last_submission_time");
    if (last) {
      const diff = Math.floor((Date.now() - parseInt(last)) / 1000);
      if (diff < 30) {
        setCooldown(30 - diff);
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
      }
    }
  }, [success]);

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
  const uploadImage = async (file: File): Promise<string | null> => {
    let uploadFile = file;

    // Apply compression if image is > 500KB
    if (file.size > 500 * 1024) {
      const options = {
        maxSizeMB: 0.45, // Target < 500KB
        maxWidthOrHeight: 1600,
        useWebWorker: true,
      };
      try {
        uploadFile = await imageCompression(file, options);
      } catch (err) {
        console.error("Image compression failed, uploading original:", err);
      }
    }

    const ext = uploadFile.name.split(".").pop() ?? "jpg";
    const path = `reports/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error } = await supabase.storage
      .from("flood-photos")
      .upload(path, uploadFile, { cacheControl: "3600", upsert: false });

    if (error) {
      console.error("Storage upload error:", error);
      return null;
    }

    const { data } = supabase.storage
      .from("flood-photos")
      .getPublicUrl(path);

    return data.publicUrl;
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

    setSubmitting(true);
    setFormError(null);

    let imageUrl: string | null = null;
    if (imageFile) {
      imageUrl = await uploadImage(imageFile);
    }

    // Optimistic object
    const optimistic: FloodReport = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      latitude: floodGeo.lat,
      longitude: floodGeo.lng,
      water_level: waterLevel,
      description,
      image_url: imageUrl,
      verified: false,
    };

    // Optimistic update
    onFloodReportCreated(optimistic);

    const { error } = await supabase.from("flood_reports").insert({
      latitude: floodGeo.lat,
      longitude: floodGeo.lng,
      water_level: waterLevel,
      description,
      image_url: imageUrl,
      verified: false,
    });

    setSubmitting(false);

    if (error) {
      setFormError(error.message);
      return;
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
    if (sosGeo.lat === null || sosGeo.lng === null) {
      setFormError("Please detect your GPS location first.");
      return;
    }

    setSubmitting(true);
    setFormError(null);

    // Optimistic object
    const optimistic: SosRequest = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      name: sosName.trim(),
      phone: sosPhone.trim(),
      latitude: sosGeo.lat,
      longitude: sosGeo.lng,
      people_count: sosPeople,
      needs: sosNeeds,
      status: "pending",
    };

    // Optimistic update
    onSosCreated(optimistic);

    const { error } = await supabase.from("sos_requests").insert({
      name: sosName.trim(),
      phone: sosPhone.trim(),
      latitude: sosGeo.lat,
      longitude: sosGeo.lng,
      people_count: sosPeople,
      needs: sosNeeds,
      status: "pending",
    });

    setSubmitting(false);

    if (error) {
      setFormError(error.message);
      return;
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
      <div className="relative z-10 w-full max-w-lg animate-slide-up rounded-t-2xl border border-surface-700/50 bg-surface-900 shadow-2xl sm:rounded-2xl">
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-surface-800 px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-bold text-surface-100">
            <AlertTriangle className="h-5 w-5 text-emergency-400" />
            Report Incident
          </h2>
          <button
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-500 transition hover:bg-surface-800 hover:text-surface-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Tab switcher ─────────────────────────────────────────────── */}
        <div className="flex border-b border-surface-800">
          <button
            onClick={() => { setTab("flood"); setFormError(null); setSuccess(false); }}
            className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-semibold transition ${
              tab === "flood"
                ? "border-b-2 border-blue-500 text-blue-400"
                : "text-surface-500 hover:text-surface-300"
            }`}
          >
            <Droplets className="h-4 w-4" />
            Report Flood Level
          </button>
          <button
            onClick={() => { setTab("sos"); setFormError(null); setSuccess(false); }}
            className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-semibold transition ${
              tab === "sos"
                ? "border-b-2 border-emergency-500 text-emergency-400"
                : "text-surface-500 hover:text-surface-300"
            }`}
          >
            <LifeBuoy className="h-4 w-4" />
            SOS / Need Help
          </button>
        </div>

        {/* ── Form body ────────────────────────────────────────────────── */}
        <div className="max-h-[60vh] overflow-y-auto px-5 py-5">
          {/* ── Success state ────────────────────────────────────────── */}
          {success ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600/20">
                <Check className="h-7 w-7 text-emerald-400" />
              </div>
              <p className="text-lg font-bold text-surface-100">
                {tab === "flood" ? "Flood Report Submitted" : "SOS Request Sent"}
              </p>
              <p className="text-sm text-surface-400">
                {tab === "flood"
                  ? "Thank you! Your report helps coordinate relief."
                  : "Help is on the way. Stay safe!"}
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
                <label className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-surface-200">
                  <Waves className="h-4 w-4 text-blue-400" />
                  Water Level
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {WATER_LEVELS.map((wl) => (
                    <button
                      key={wl.value}
                      type="button"
                      onClick={() => setWaterLevel(wl.value)}
                      className={`flex flex-col items-start rounded-lg border p-3 text-left transition ${
                        waterLevel === wl.value
                          ? "border-blue-500 bg-blue-500/10 text-blue-300"
                          : "border-surface-700 bg-surface-850 text-surface-400 hover:border-surface-600 hover:text-surface-300"
                      }`}
                    >
                      <span className="text-base">{wl.icon}</span>
                      <span className="text-sm font-semibold">{wl.label}</span>
                      <span className="text-[11px] opacity-70">{wl.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-surface-200">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Describe the flooding situation…"
                  className="w-full resize-none rounded-lg border border-surface-700 bg-surface-850 px-3 py-2.5 text-sm text-surface-200 placeholder-surface-600 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                />
              </div>

              {/* Image upload */}
              <div>
                <label className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-surface-200">
                  <Camera className="h-4 w-4 text-surface-400" />
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
                <input
                  ref={floodFileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
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
                <label className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-surface-200">
                  <User className="h-4 w-4 text-surface-400" />
                  Your Name
                </label>
                <input
                  type="text"
                  value={sosName}
                  onChange={(e) => setSosName(e.target.value)}
                  placeholder="Full name"
                  className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2.5 text-sm text-surface-200 placeholder-surface-600 outline-none transition focus:border-emergency-500 focus:ring-1 focus:ring-emergency-500/30"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-surface-200">
                  <Phone className="h-4 w-4 text-surface-400" />
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={sosPhone}
                  onChange={(e) => setSosPhone(e.target.value)}
                  placeholder="+91 XXXXX XXXXX"
                  className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2.5 text-sm text-surface-200 placeholder-surface-600 outline-none transition focus:border-emergency-500 focus:ring-1 focus:ring-emergency-500/30"
                />
              </div>

              {/* People count */}
              <div>
                <label className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-surface-200">
                  <Users className="h-4 w-4 text-surface-400" />
                  Number of Trapped People
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSosPeople((p) => Math.max(1, p - 1))}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-surface-700 bg-surface-850 text-lg font-bold text-surface-300 transition hover:bg-surface-800"
                  >
                    −
                  </button>
                  <span className="w-12 text-center text-xl font-bold tabular-nums text-surface-100">
                    {sosPeople}
                  </span>
                  <button
                    type="button"
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
                            ? "border-emergency-600 bg-emergency-600/15 text-emergency-300"
                            : "border-surface-700 bg-surface-850 text-surface-400 hover:border-surface-600 hover:text-surface-300"
                        }`}
                      >
                        <div
                          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                            active
                              ? "border-emergency-500 bg-emergency-500"
                              : "border-surface-600 bg-surface-800"
                          }`}
                        >
                          {active && <Check className="h-3 w-3 text-white" />}
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
          <div className="mx-5 mb-3 flex items-center gap-2 rounded-lg border border-emergency-700/50 bg-emergency-950/60 px-3 py-2 text-xs text-emergency-300">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {formError}
          </div>
        )}

        {/* ── Submit footer ────────────────────────────────────────────── */}
        {!success && (
          <div className="border-t border-surface-800 px-5 py-4">
            <button
              onClick={tab === "flood" ? submitFloodReport : submitSos}
              disabled={submitting}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold uppercase tracking-wider transition disabled:opacity-60 ${
                tab === "flood"
                  ? "bg-blue-600 text-white hover:bg-blue-500 active:bg-blue-700"
                  : "bg-emergency-600 text-white hover:bg-emergency-500 active:bg-emergency-700"
              }`}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : tab === "flood" ? (
                <>
                  <Droplets className="h-4 w-4" />
                  Submit Flood Report
                </>
              ) : (
                <>
                  <LifeBuoy className="h-4 w-4" />
                  Send SOS Request
                </>
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
    <div>
      <label className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-surface-200">
        <MapPin className="h-4 w-4 text-surface-400" />
        GPS Location
      </label>

      {geo.lat !== null && geo.lng !== null ? (
        <div className="flex items-center gap-3">
          <div className="flex-1 rounded-lg border border-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
            <span className="font-mono">
              {geo.lat.toFixed(6)}, {geo.lng.toFixed(6)}
            </span>
          </div>
          <button
            type="button"
            onClick={geo.detect}
            disabled={geo.locating}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-surface-700 bg-surface-850 text-surface-400 transition hover:text-surface-200"
            title="Re-detect GPS"
          >
            {geo.locating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Crosshair className="h-4 w-4" />
            )}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={geo.detect}
          disabled={geo.locating}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-surface-700 py-4 text-sm text-surface-500 transition hover:border-surface-500 hover:text-surface-300 disabled:opacity-60"
        >
          {geo.locating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Detecting location…
            </>
          ) : (
            <>
              <Crosshair className="h-4 w-4" />
              Auto-detect GPS Location
            </>
          )}
        </button>
      )}

      {geo.error && (
        <p className="mt-1.5 text-xs text-emergency-400">
          Location error: {geo.error}
        </p>
      )}
    </div>
  );
}
