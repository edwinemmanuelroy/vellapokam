"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";

/**
 * In-app toasts.
 *
 * Distinct from push notifications: these fire for people already looking at
 * the dashboard. An SOS toast is deliberately sticky and assertive — it is the
 * one message a responder must not miss.
 */

export type ToastTone = "sos" | "warning" | "info" | "success" | "error";

export interface ToastOptions {
  title: string;
  message?: string;
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss. `null` keeps it until dismissed. */
  duration?: number | null;
  action?: { label: string; onClick: () => void };
  /** Dedupe key — re-showing the same key replaces rather than stacks. */
  key?: string;
}

interface Toast extends ToastOptions {
  id: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (options: ToastOptions) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Safe to call from components rendered outside the provider (returns no-ops). */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  return useMemo(
    () => ctx ?? { showToast: () => {}, dismissToast: () => {} },
    [ctx]
  );
}

const TONE_STYLES: Record<ToastTone, string> = {
  sos: "border-emergency-500/70 bg-emergency-950/95 text-emergency-100",
  warning: "border-warning-600/60 bg-surface-900/95 text-warning-200",
  error: "border-emergency-700/60 bg-surface-900/95 text-emergency-300",
  success: "border-surface-600 bg-surface-900/95 text-surface-100",
  info: "border-surface-700 bg-surface-900/95 text-surface-200",
};

const DEFAULT_DURATION = 6000;
/** Cap the stack so a burst of SOS reports cannot cover the whole screen. */
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (options: ToastOptions) => {
      const tone = options.tone ?? "info";
      const id = options.key ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      setToasts((prev) => {
        // Replace a same-key toast in place so repeats don't pile up.
        const withoutDup = prev.filter((t) => t.id !== id);
        const next = [...withoutDup, { ...options, id, tone }];
        return next.slice(-MAX_VISIBLE);
      });

      // An SOS stays until acted on unless the caller overrides.
      const duration =
        options.duration === undefined
          ? tone === "sos"
            ? null
            : DEFAULT_DURATION
          : options.duration;

      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);

      if (duration !== null) {
        timers.current.set(
          id,
          setTimeout(() => dismissToast(id), duration)
        );
      }
    },
    [dismissToast]
  );

  // Clear pending timers on unmount so a dismiss can't fire into a dead tree.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Bottom-left: clear of the SOS/report FABs pinned bottom-right. */}
      <div
        /* Above the mobile drawer (z-1050): an incoming SOS must be visible
           even while someone is reading the rescue queue. */
        className="pointer-events-none fixed bottom-4 left-4 z-[1100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "sos" || toast.tone === "error" ? "alert" : "status"}
            aria-live={toast.tone === "sos" ? "assertive" : "polite"}
            className={`pointer-events-auto animate-slide-up rounded-lg border p-3 shadow-lg shadow-black/50 backdrop-blur-sm ${TONE_STYLES[toast.tone]}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {toast.tone === "sos" && (
                  <span className="relative flex h-2 w-2 flex-shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emergency-400 opacity-70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emergency-400" />
                  </span>
                )}
                <span className="text-xs font-bold uppercase tracking-wider">
                  {toast.title}
                </span>
              </div>
              <button
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
                className="-m-1.5 flex-shrink-0 rounded-sm p-1.5 opacity-60 transition hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {toast.message && (
              <p className="mt-1 text-[11px] leading-relaxed opacity-90">{toast.message}</p>
            )}

            {toast.action && (
              <button
                onClick={() => {
                  toast.action?.onClick();
                  dismissToast(toast.id);
                }}
                className="mt-2 rounded-sm border border-current px-2 py-1 text-[10px] font-bold uppercase tracking-wider opacity-90 transition hover:opacity-100"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
