import type { Config } from "tailwindcss";

/** Semantic colour backed by an RGB-channel CSS variable from globals.css. */
const token = (name: string) => `rgb(var(--color-${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/features/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: token("background"),
        surface: token("surface"),
        muted: token("muted"),
        border: {
          DEFAULT: token("border"),
          strong: token("border-strong"),
        },
        fg: {
          DEFAULT: token("fg"),
          muted: token("fg-muted"),
          subtle: token("fg-subtle"),
        },
        accent: {
          DEFAULT: token("accent"),
          hover: token("accent-hover"),
          fg: token("accent-fg"),
          subtle: token("accent-subtle"),
          text: token("accent-text"),
        },
        success: {
          DEFAULT: token("success"),
          subtle: token("success-subtle"),
          border: token("success-border"),
        },
        warning: {
          DEFAULT: token("warning"),
          subtle: token("warning-subtle"),
          border: token("warning-border"),
        },
        danger: {
          DEFAULT: token("danger"),
          solid: token("danger-solid"),
          subtle: token("danger-subtle"),
          border: token("danger-border"),
        },
        info: {
          DEFAULT: token("info"),
          subtle: token("info-subtle"),
          border: token("info-border"),
        },
        overlay: token("overlay"),
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      spacing: {
        topbar: "var(--topbar-height)",
        sidebar: "var(--sidebar-width)",
      },
      maxWidth: {
        content: "var(--content-max)",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"],
      },
      keyframes: {
        "toast-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "toast-in": "toast-in 150ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
