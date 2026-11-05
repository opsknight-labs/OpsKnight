---
trigger: always_on
description: Design, layout, and rendering rules for transactional email templates
---

# Transactional Email Standards

1. **Email Architecture**:
   - Every email is a React Email template in `src/emails/templates/` built from `src/emails/components.tsx` (`EmailLayout`, `HeaderBand` (brand mark + title),  `Badge`, `InfoTable`, `Callout`, `Button`, `LinkFallback`, `EmailFooter`, `SubscriberFooter`) and rendered with `renderEmail()` from `src/emails/render.tsx`.
   - Never hand-write email HTML elsewhere; `tests/architecture/email-contract.test.ts` enforces it.
   - Every template default-exports its component with `PreviewProps`, so `npm run email:dev` previews it.

2. **Client compatibility (Outlook Word engine, new Outlook, Gmail, Apple Mail, Yahoo)**:
   - Tables only: no flex, grid, position, or SVG.
   - Solid `bgcolor` under every gradient; CTAs use the bulletproof `Button` (VML roundrect + link).
   - Images are absolute https PNGs with width, height, and alt; no data: URIs.
   - Stay under 102 KB of HTML (Gmail clipping).

3. **Dark mode (three layers, from `dm-*` classes in `src/emails/styles.ts`)**:
   - `prefers-color-scheme` media query, `[data-ogsc]`/`[data-ogsb]` Outlook.com selectors, and an inversion-safe palette for Gmail apps and Outlook for Windows.
   - Anything coloured gets a `dm-*` class; use tokens from `src/emails/tokens.ts`, never ad-hoc hex values.

4. **Subtle & Clutter-Free**:
   - No promotional popups, GitHub star buttons, or loud advertising banners in transactional alert emails.
   - Footers stay clean: "This is an automated notification from OpsKnight Incident Management • OpsKnight • Open-Source Incident Response", hyperlinked to `https://opsknight.com/`.

5. **Status-Driven Dynamic Styling**:
   - Header band, badge, accent rules, and CTA follow the incident urgency or lifecycle tone (critical → crimson, elevated → amber, ok → emerald, info → cobalt, shift → royal violet).

6. **Structured Incident Description**:
   - Incident descriptions use `Callout surface="muted" preformatted`: the `#f8fafc` card with a 4px status accent and `white-space: pre-wrap`, so multi-paragraph telemetry, bullet points, and code traces keep their formatting.

7. **Bulk subscriber email**:
   - Render once with `{{unsubscribe_url}}`-style placeholders (they survive `safeHref`); pass `listUnsubscribeUrl` so the control plane sends RFC 8058 one-click `List-Unsubscribe` headers.
