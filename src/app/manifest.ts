import type { MetadataRoute } from "next";

/**
 * Web app manifest.
 *
 * Installing to the Home Screen is not a nice-to-have here: on iOS it is the
 * only way the Push API becomes available at all (Safari tabs have no
 * PushManager), so a trapped-neighbour alert cannot reach an iPhone user
 * unless they install. The consent UI explains this.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kerala Flood Emergency Dashboard",
    short_name: "Kerala SOS",
    description:
      "Send an SOS, see rescue requests near you, and get alerted when someone nearby needs help.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0d0e10",
    theme_color: "#0d0e10",
    categories: ["utilities", "navigation"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
