import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ["Charter", "Georgia", "Cambria", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        paper: "#faf9f6",
        ink: "#1a1917",
        muted: "#6b6862",
        rule: "#e3e0d8",
      },
    },
  },
  plugins: [],
} satisfies Config;
