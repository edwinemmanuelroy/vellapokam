import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* ── Emergency palette ─────────────────────────────── */
        emergency: {
          50:  "#fff5f5",
          100: "#ffe3e3",
          200: "#ffc9c9",
          300: "#ffa8a8",
          400: "#ff6b6b",
          500: "#fa5252",
          600: "#e03131",
          700: "#c92a2a",
          800: "#a51c1c",
          900: "#7a1414",
          950: "#4a0c0c",
        },
        warning: {
          50:  "#fff9db",
          100: "#fff3bf",
          200: "#ffec99",
          300: "#ffe066",
          400: "#ffd43b",
          500: "#fcc419",
          600: "#fab005",
          700: "#f59f00",
          800: "#e67e00",
          900: "#d16800",
          950: "#8a4500",
        },
        surface: {
          50:  "#f8f9fa",
          100: "#e9ecef",
          200: "#dee2e6",
          300: "#ced4da",
          400: "#adb5bd",
          500: "#868e96",
          600: "#495057",
          700: "#343a40",
          800: "#212529",
          850: "#1a1d21",
          900: "#141517",
          950: "#0d0e10",
        },
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      keyframes: {
        "pulse-emergency": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "slide-up": {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "beacon": {
          "0%":   { boxShadow: "0 0 0 0 rgba(250, 82, 82, 0.6)" },
          "70%":  { boxShadow: "0 0 0 12px rgba(250, 82, 82, 0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(250, 82, 82, 0)" },
        },
      },
      animation: {
        "pulse-emergency": "pulse-emergency 1.5s ease-in-out infinite",
        "slide-up": "slide-up 0.4s ease-out",
        "beacon": "beacon 1.5s ease-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
