import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { ToastProvider } from "@/components/Toast/ToastProvider";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Kerala Flood Emergency Dashboard",
  description:
    "Real-time flood monitoring and SOS rescue coordination dashboard for Kerala. Report water levels, request rescue, and track relief efforts.",
  keywords: [
    "Kerala flood",
    "emergency dashboard",
    "SOS rescue",
    "flood relief",
    "disaster management",
    "real-time monitoring",
  ],
  openGraph: {
    title: "Kerala Flood Emergency Dashboard",
    description:
      "Real-time flood monitoring and SOS rescue coordination for Kerala.",
    type: "website",
  },
  manifest: "/manifest.webmanifest",
  // `capable` is what lets iOS run this as a standalone app from the Home
  // Screen — and on iOS that installation is the only path to push at all.
  appleWebApp: {
    capable: true,
    title: "Kerala SOS",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0e10",
  width: "device-width",
  initialScale: 1,
  // The map and SOS form must stay pinch-zoomable — locking scale would fail
  // anyone with low vision trying to file an emergency request.
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-surface-950 text-surface-100`}
      >
        {/* ── Top status strip: quiet chrome, red only as the signal ── */}
        <div className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-surface-800 border-t-2 border-t-emergency-600 bg-surface-950 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-surface-300">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emergency-500 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emergency-500" />
          </span>
          Emergency Active — Kerala Flood Response 2026
        </div>

        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
