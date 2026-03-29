/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Legacy nested surface tokens (kept for backwards compat) ──
        surface: {
          DEFAULT: '#0b0e16',
          container: {
            DEFAULT: '#161923',
            lowest: '#000000',
            high: '#1c1f2a',
            highest: '#222532',
          },
        },
        primary: {
          DEFAULT: '#bd9dff',
          dim: '#8a4cfc',
        },
        secondary: {
          DEFAULT: '#09f1d5',
          dim: '#00e2c7',
        },
        on: {
          surface: {
            DEFAULT: '#e4e4f1',
            variant: '#a9aab6',
          },
        },
        outline: {
          DEFAULT: '#958e9c',
          variant: '#454751',
        },

        // ── Neural Chip Design System flat tokens ──
        // Surfaces
        "surface-container-lowest":  "#0b0e17",
        "surface-container-low":     "#181b25",
        "surface-container":         "#1c1f29",
        "surface-container-high":    "#272a34",
        "surface-container-highest": "#32343f",
        "surface-dim":               "#10131d",
        "surface-bright":            "#363944",
        "surface-variant":           "#32343f",
        "background":                "#10131d",

        // Primary — purple
        "primary-container":        "#bd9dff",
        "primary-fixed":            "#eaddff",
        "primary-fixed-dim":        "#d2bbff",
        "on-primary":               "#3b1a77",
        "on-primary-fixed":         "#25005a",
        "on-primary-container":     "#4d2e89",
        "on-primary-fixed-variant": "#53348e",
        "inverse-primary":          "#6b4da8",

        // Secondary — cyan
        "secondary-container":      "#00eed3",
        "secondary-fixed":          "#30fde1",
        "secondary-fixed-dim":      "#00dfc5",
        "on-secondary":             "#003730",
        "on-secondary-fixed":       "#00201b",
        "on-secondary-container":   "#00675b",
        "on-secondary-fixed-variant": "#005046",

        // Tertiary
        "tertiary":                 "#d4ce4d",
        "tertiary-container":       "#b8b233",
        "tertiary-fixed":           "#eee763",
        "tertiary-fixed-dim":       "#d1cb4a",
        "on-tertiary":              "#343200",
        "on-tertiary-fixed":        "#1e1c00",
        "on-tertiary-container":    "#464300",
        "on-tertiary-fixed-variant":"#4c4900",

        // Text
        "on-surface":               "#e0e2f0",
        "on-surface-variant":       "#cbc4d3",
        "on-background":            "#e0e2f0",

        // Borders
        "outline-solid":            "#958e9c",

        // Error
        "error":                    "#ffb4ab",
        "error-container":          "#93000a",
        "on-error":                 "#690005",
        "on-error-container":       "#ffdad6",

        // Misc
        "inverse-surface":          "#e0e2f0",
        "inverse-on-surface":       "#2d303b",
        "surface-tint":             "#d2bbff",
      },

      fontFamily: {
        // Legacy
        sans: ['Syne', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        // Neural Chip
        headline: ['Syne', 'sans-serif'],
        syne:     ['Syne', 'sans-serif'],
        body:     ['Manrope', 'sans-serif'],
        label:    ['JetBrains Mono', 'monospace'],
        display:  ['Space Grotesk', 'sans-serif'],
      },

      borderRadius: {
        DEFAULT: '0.125rem',
        sm:  '0.25rem',
        lg:  '0.25rem',
        xl:  '0.5rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        full: '9999px',
      },
    },
  },
  plugins: [],
}
