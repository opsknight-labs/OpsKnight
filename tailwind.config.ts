import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';
import { STATUS_TAILWIND_COLORS } from './src/lib/design/status-palette';
import { TAILWIND_FONT_SIZES } from './src/lib/design/type-scale';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        // Brand typography (AGENTS.md "Typography"): Inter for UI/body,
        // Space Grotesk for titles, badges and brand marks. Stacks live in
        // styles/foundation/tokens.css so CSS and Tailwind never drift.
        sans: ['var(--font-family-sans)'],
        display: ['var(--font-family-display)'],
        mono: ['var(--font-family-mono)'],
      },
      // One rem scale, defined in src/styles/foundation/tokens.css; `text-<step>`
      // resolves the same CSS variables (DESIGN.md "Typography").
      fontSize: TAILWIND_FONT_SIZES,
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
        extrabold: '800',
      },
      letterSpacing: {
        tighter: 'var(--letter-spacing-tighter)',
        tight: 'var(--letter-spacing-tight)',
        snug: 'var(--letter-spacing-snug)',
        normal: 'var(--letter-spacing-normal)',
        wide: 'var(--letter-spacing-wide)',
        wider: 'var(--letter-spacing-wider)',
        widest: 'var(--letter-spacing-widest)',
      },
      lineHeight: {
        none: '1',
        tight: '1.2',
        snug: '1.3',
        normal: '1.5',
        relaxed: '1.55',
        loose: '1.65',
      },
      // The legacy stylesheet still exposes names such as --primary, --border
      // and --secondary as hex colors. shadcn/Tailwind expects HSL channels.
      // Keep the design-system contract isolated under --ui-* so the two token
      // generations cannot corrupt one another while legacy CSS is removed.
      colors: {
        // Status colour semantics (AGENTS.md); see src/lib/design/status-palette.ts
        status: STATUS_TAILWIND_COLORS,
        // Theme-aware neutral scale. Light values equal Tailwind `slate`
        // exactly; the dark theme inverts it (src/styles/index.css).
        ink: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map(shade => [
            shade,
            `rgb(var(--ink-${shade}) / <alpha-value>)`,
          ])
        ),
        border: 'hsl(var(--ui-border) / <alpha-value>)',
        input: 'hsl(var(--ui-input) / <alpha-value>)',
        ring: 'hsl(var(--ui-ring) / <alpha-value>)',
        background: 'hsl(var(--ui-background) / <alpha-value>)',
        foreground: 'hsl(var(--ui-foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--ui-primary) / <alpha-value>)',
          foreground: 'hsl(var(--ui-primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--ui-secondary) / <alpha-value>)',
          foreground: 'hsl(var(--ui-secondary-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--ui-destructive) / <alpha-value>)',
          foreground: 'hsl(var(--ui-destructive-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--ui-muted) / <alpha-value>)',
          foreground: 'hsl(var(--ui-muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--ui-accent) / <alpha-value>)',
          foreground: 'hsl(var(--ui-accent-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--ui-popover) / <alpha-value>)',
          foreground: 'hsl(var(--ui-popover-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--ui-card) / <alpha-value>)',
          foreground: 'hsl(var(--ui-card-foreground) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--ui-radius)',
        md: 'calc(var(--ui-radius) - 2px)',
        sm: 'calc(var(--ui-radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'ambient-move': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'breathing-glow': {
          '0%, 100%': {
            boxShadow:
              '0 0 0 0 rgba(var(--status-color-rgb), 0), 0 0 0 0 rgba(var(--status-color-rgb), 0)',
          },
          '50%': { boxShadow: '0 0 8px 2px rgba(var(--status-color-rgb), 0.2)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
        'radar-spin': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        'grid-flow': {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(40px)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'ambient-move': 'ambient-move 15s ease infinite',
        'breathing-glow': 'breathing-glow 3s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        'pulse-subtle': 'pulse-subtle 3s ease-in-out infinite',
        'radar-spin': 'radar-spin 4s linear infinite',
        'grid-flow': 'grid-flow 20s linear infinite',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
