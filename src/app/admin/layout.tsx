import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ops Console — Kerala Flood Dashboard",
  description: "Operator console for the Kerala Flood Emergency Dashboard.",
  // The operator console is not for search engines.
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
