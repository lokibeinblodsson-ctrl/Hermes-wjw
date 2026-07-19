/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{ts,tsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Muted-indigo workspace sidebar palette (WJW Chat)
        ink: {
          950: "#15131f",
          900: "#1c1929",
          850: "#221e31",
          800: "#2a2540",
          700: "#352f4d",
          600: "#473f63",
        },
        moss: { DEFAULT: "#6f8f7d", soft: "#8aa897" },
        clay: { DEFAULT: "#cf9f8f", soft: "#e0bcaf" },
        // light conversation surface
        surface: { DEFAULT: "#f7f6f3", raised: "#ffffff", sunken: "#efece6" },
        line: "#e3dfd6",
        slate: { DEFAULT: "#3c3a44", muted: "#6b6878" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(20,18,31,0.06), 0 8px 24px rgba(20,18,31,0.08)",
        pop: "0 10px 40px rgba(20,18,31,0.18)",
      },
      keyframes: {
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "pop-in": { "0%": { transform: "scale(0.92)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
        "slide-in-right": { "0%": { transform: "translateX(16px)", opacity: "0" }, "100%": { transform: "translateX(0)", opacity: "1" } },
      },
      animation: {
        "fade-in": "fade-in 120ms ease-out",
        "pop-in": "pop-in 120ms ease-out",
        "slide-in-right": "slide-in-right 160ms ease-out",
      },
    },
  },
  plugins: [],
};
