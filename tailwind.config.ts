import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

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
        sans: [
          'var(--font-manrope)',
          'Manrope',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        display: [
          'var(--font-manrope)',
          'Manrope',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['SF Mono', 'Fira Code', 'Monaco', 'Cascadia Code', 'monospace'],
        serif: [
          'var(--font-serif)',
          'Instrument Serif',
          'Playfair Display',
          'ui-serif',
          'Georgia',
          'Cambria',
          'serif',
        ],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
        xs: ['0.75rem', { lineHeight: '1.1rem', letterSpacing: '0.01em' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem', letterSpacing: '0' }],
        base: ['0.9375rem', { lineHeight: '1.5rem', letterSpacing: '-0.003em' }],
        lg: ['1.0625rem', { lineHeight: '1.625rem', letterSpacing: '-0.005em' }],
        xl: ['1.125rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        '2xl': ['1.375rem', { lineHeight: '1.875rem', letterSpacing: '-0.015em' }],
        '3xl': ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.02em' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.025em' }],
        '5xl': ['3rem', { lineHeight: '3.25rem', letterSpacing: '-0.03em' }],
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
        extrabold: '800',
      },
      letterSpacing: {
        tighter: '-0.03em',
        tight: '-0.02em',
        snug: '-0.01em',
        normal: '0',
        wide: '0.01em',
        wider: '0.02em',
        widest: '0.08em',
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
