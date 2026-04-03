import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        heading: ['"Space Grotesk"', "sans-serif"],
        body: ['"Inter"', "sans-serif"],
        code: ['"JetBrains Mono"', "monospace"],
      },
      colors: {
        gitlore: {
          bg: "var(--bg)",
          surface: "var(--surface)",
          "surface-hover": "var(--surface-hover)",
          border: "var(--border)",
          text: "var(--text)",
          "text-secondary": "var(--text-secondary)",
          accent: "var(--accent)",
          "accent-hover": "var(--accent-hover)",
          "accent-fg": "#ffffff",
          success: "var(--success)",
          warning: "var(--warning)",
          error: "var(--error)",
          code: "var(--code-bg)",
        },
      },
      borderRadius: {
        sm: "var(--radius)",
        DEFAULT: "var(--radius)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.5s ease-out forwards",
      },
    },
  },
  plugins: [],
} satisfies Config;
