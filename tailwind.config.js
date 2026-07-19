/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{ts,tsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Mapped to the site's calm dark palette in app/styles.css so the chat
        // mirrors the rest of the web app exactly.
        ink: {
          950: "#121512", // --bg
          900: "#1c221c", // --panel
          850: "#212821", // between panel and panel-2
          800: "#252c25", // --panel-2
          700: "#2f372f", // hover surface
          600: "#3a443a",
        },
        moss: { DEFAULT: "#8aa66f", soft: "#9cb881" }, // --accent / --accent-2
        clay: { DEFAULT: "#cf9f8f", soft: "#e0bcaf" }, // --clay (warm accent)
        warn: { DEFAULT: "#d8b878" }, // --warn (amber)
        danger: { DEFAULT: "#d29292" }, // --danger (clay-red)
        // conversation surface (dark, matching the site)
        surface: { DEFAULT: "#1c221c", raised: "#252c25", sunken: "#161a16" },
        line: "#333d33", // --border
        slate: { DEFAULT: "#dde4dc", muted: "#8a9a88" }, // --text / --muted
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.25)",
        pop: "0 10px 40px rgba(0,0,0,0.4)",
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
