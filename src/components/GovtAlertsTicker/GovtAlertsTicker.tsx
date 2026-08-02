"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Advisory } from "@/types/database";
import { Megaphone, PhoneCall, ArrowRight, ArrowLeft, Loader2 } from "lucide-react";

const SEED_ALERTS: Advisory[] = [
  {
    id: "1",
    created_at: new Date().toISOString(),
    title: "KSDMA RED ALERT",
    message: "Red Alert issued for Wayanad & Idukki. Heavy to extremely heavy rainfall expected over next 24 hours.",
    type: "critical",
    link: null,
  },
  {
    id: "2",
    created_at: new Date().toISOString(),
    title: "Irrigation Dept",
    message: "Idukki Cheruthoni Dam shutters likely to be raised by 50cm. Inhabitants on Periyar banks advised to stay vigilant.",
    type: "critical",
    link: null,
  },
  {
    id: "3",
    created_at: new Date().toISOString(),
    title: "State Control Room",
    message: "NDRF teams deployed in Thrissur, Ernakulam, and Alappuzha. Dial 1077 for emergency assistance.",
    type: "info",
    link: null,
  },
];

export default function GovtAlertsTicker() {
  const [alerts, setAlerts] = useState<Advisory[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  // Fetch initial advisories from database
  const fetchAdvisories = async () => {
    try {
      const { data, error } = await supabase
        .from("advisories")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (data && data.length > 0) {
        setAlerts(data as Advisory[]);
      } else {
        setAlerts(SEED_ALERTS);
      }
    } catch (err) {
      console.error("Failed to load advisories, using fallback:", err);
      setAlerts(SEED_ALERTS);
    } finally {
      setLoading(false);
    }
  };

  // Real-time advisories subscription
  useEffect(() => {
    fetchAdvisories();

    const channel = supabase
      .channel("advisories-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "advisories" },
        () => {
          fetchAdvisories();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Slide loop timer
  useEffect(() => {
    if (alerts.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % alerts.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [alerts]);

  const activeAlert = alerts[currentIndex] || SEED_ALERTS[0];

  const handleNext = () => {
    if (alerts.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % alerts.length);
  };

  const handlePrev = () => {
    if (alerts.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + alerts.length) % alerts.length);
  };

  const formatTime = (timeStr: string) => {
    const ms = Date.now() - new Date(timeStr).getTime();
    const min = Math.floor(ms / (1000 * 60));
    if (min < 1) return "Just now";
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(timeStr).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  };

  const typeColor =
    activeAlert.type === "critical"
      ? "text-red-400 bg-red-950/50 border-red-500/30 font-bold"
      : activeAlert.type === "warning"
      ? "text-warning-400 bg-warning-950/50 border-warning-500/30"
      : "text-blue-400 bg-blue-950/50 border-blue-500/30";

  return (
    <div className="w-full card-glass border-surface-700/60 overflow-hidden flex flex-col md:flex-row items-stretch min-h-[50px] shadow-md">
      {/* Helpline Shortcuts */}
      <div className="flex items-center gap-4 bg-emergency-900/40 border-b md:border-b-0 md:border-r border-surface-800 px-4 py-2.5 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emergency-300">
          <PhoneCall className="h-4 w-4 text-emergency-400" />
          Emergency Hotlines:
        </div>
        <div className="flex items-center gap-3 text-sm font-black text-surface-50">
          <a href="tel:1077" className="hover:underline flex items-center gap-1">
            District: <span className="text-emergency-400">1077</span>
          </a>
          <span className="text-surface-700">|</span>
          <a href="tel:112" className="hover:underline flex items-center gap-1">
            Police: <span className="text-emergency-400">112</span>
          </a>
        </div>
      </div>

      {/* Ticker Content */}
      <div className="flex-1 flex items-center justify-between px-4 py-2.5 gap-4 overflow-hidden">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-surface-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading emergency alerts...
          </div>
        ) : (
          <div className="flex items-center gap-3 overflow-hidden flex-1">
            <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[10px] uppercase tracking-wider ${typeColor}`}>
              <Megaphone className="h-3 w-3" />
              {activeAlert.title}
            </div>
            <p className={`text-xs md:text-sm font-semibold truncate flex-1 ${activeAlert.type === "critical" ? "text-red-400" : "text-surface-200"}`}>
              {activeAlert.message}
            </p>
            <span className="text-[10px] font-medium text-surface-500 whitespace-nowrap hidden sm:inline">
              ({formatTime(activeAlert.created_at)})
            </span>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handlePrev}
            className="flex h-7 w-7 items-center justify-center rounded bg-surface-850 hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={handleNext}
            className="flex h-7 w-7 items-center justify-center rounded bg-surface-850 hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
