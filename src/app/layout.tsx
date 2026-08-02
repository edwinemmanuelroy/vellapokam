import type { Metadata } from "next";
import localFont from "next/font/local";
import "leaflet/dist/leaflet.css";
import "./globals.css";

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
        {/* ── Top emergency banner ── */}
        <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-emergency-700/90 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-white backdrop-blur-sm sm:text-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
          Emergency Active — Kerala Flood Response 2026
        </div>

        {children}
      </body>
    </html>
  );
}
