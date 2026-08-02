/** @type {import('next').NextConfig} */
const nextConfig = {
  // A production build and a running `next dev` both write `.next` by default,
  // and the build replaces chunks the dev server still holds references to —
  // which crashes it with "Cannot find module './<id>.js'". Set
  // NEXT_DIST_DIR=.next-verify to build safely alongside a live dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Stop the dashboard being framed inside a lookalike emergency site
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // `geolocation=(self)` is required — reporting a flood level or an
          // SOS depends on it. Everything else is switched off.
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(self), microphone=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
