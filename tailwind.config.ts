import type { Config } from "tailwindcss";

// Tailwind CSS v4 is CSS-first (configuration primarily lives in globals.css via
// `@import "tailwindcss"`). This file is kept for compatibility / explicit content
// globbing. The base responsive approach is Tailwind's mobile-first defaults.
const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
