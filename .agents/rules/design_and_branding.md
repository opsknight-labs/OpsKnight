---
trigger: always_on
description: Visual design, branding, typography, and responsive standards for OpsKnight
---

# OpsKnight Design & Branding Guidelines

1. **Aesthetic Philosophy**:
   - Modern, sleek, subtle, and minimalist SRE aesthetic.
   - Avoid intrusive promotional cards, noisy gamification banners, or excessive marketing copy in transactional alerts and dashboards.

2. **Official OpsKnight Logo**:
   - Always use the background-less transparent logo (`/logo.png` or `public/logo.png`).
   - SVG vector fallback: Shield with knight headset mark in `#ef4444` to `#b91c1c` gradient.
   - **Never** enclose the logo in an opaque dark square or squircle (`#0f172a`) in transparent or light-mode contexts.
   - Use the shared lockups: `BrandLockup` in the app, `AuthBrand` on public/auth pages.

3. **Official Brand Hyperlinks**:
   - The OpsKnight brand logo, brand name text, and footer attribution marks must always be hyperlinked to `https://opsknight.com/`.
   - In configurable styles (`EmailStyles`), provide `brandUrl?: string` defaulting to `https://opsknight.com/`.

4. **Typography**:
   - Brand Headers & Badges: `'Space Grotesk'`, -apple-system, BlinkMacSystemFont, sans-serif.
   - Body & General UI: Inter, system-ui, sans-serif.
   - Both are bundled via `next/font/local`. Never hard-code a family: use `--font-family-sans` / `--font-family-display` in CSS and `font-sans` / `font-display` in Tailwind (emails excepted).

5. **Status Color Semantics**:
   - 🔴 **Critical / High Urgency / Triggered**: Crimson Red (`#881337` to `#e11d48`)
   - 🟠 **Elevated / Medium Urgency / Acknowledged**: Warm Amber / Orange (`#78350f` to `#d97706`)
   - 🟢 **Resolved / Operational**: Emerald Green (`#047857` to `#059669`)
   - 🔵 **Standard / Low Urgency / Info**: Cobalt Blue (`#1e3a8a` to `#3b82f6`)
   - 🟣 **On-Call Shifts & Rotations**: Royal Violet (`#4c1d95` to `#7c3aed`)
   - Source of truth: `src/lib/design/status-palette.ts`, exposed as Tailwind `status-{critical,elevated,ok,info,shift}` (`-deep`, `-border`, `-soft`). Success is emerald, never Tailwind `green`.

6. **Big-Screen & Responsive Scaling**:
   - Support fluid mobile layouts (`<= 640px`).
   - Support desktop layouts (`>= 1024px`, container `860px`).
   - Support 27-inch / Quad-HD monitors (`>= 1440px`, container expanded to **1080px**, padding `54px 64px`, logo `72px`).
   - Support Ultrawide & 4K monitors (`>= 1920px`, container expanded to **1180px**, padding `60px 76px`, logo `76px`).
   - These container widths are for emails. The app console stays fluid; `.page-shell` gutters scale at 1440px / 1920px.
