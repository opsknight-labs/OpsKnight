---
name: opsknight-email-designer
description: Expert runbook for designing, modifying, and testing responsive OpsKnight email templates.
---

# OpsKnight Email Design Runbook

Step-by-step instructions for creating, updating, and verifying OpsKnight email templates.

## Architecture
- **Templates**: `src/emails/templates/*.tsx`. One email per file, default-exported with `PreviewProps`.
- **Primitives**: `src/emails/components.tsx`.
  - `EmailLayout({ preview, title, footer })`: head, dark mode, Outlook ghost table, card.
  - `HeaderBand({ tone, brand, eyebrow, title, subtitle })` at the top of every card (logo on a white chip + wordmark, then the title), then `Content`.
  - `Badge`, `Heading`, `Paragraph`, `Strong`, `TextLink`, `InfoTable({ items, tone })`, `Callout({ tone, title, surface, preformatted })`, `BulletList`, `Button({ href, tone })`, `LinkFallback`.
  - `EmailFooter({ settingsUrl, unsubscribeUrl, reason })` / `SubscriberFooter({ pageName, unsubscribeUrl })`.
- **Tokens**: `src/emails/tokens.ts` (tones `critical | elevated | ok | info | shift | neutral`, surfaces, fonts).
- **Styles**: `src/emails/styles.ts` (responsive + big-screen tiers, three-layer dark mode from `dm-*` classes).
- **Render**: `await renderEmail(<Template {...props} />, { text })` returns `{ html, text }`. Library code in `.ts` files calls the component as a function: `renderEmail(Template(props))`.

## Adding or changing an email
1. Build it from the primitives. Give anything coloured a `dm-*` class and use token colours only.
2. Add realistic `PreviewProps` (long titles, optional fields present).
3. Wire it from the sender with `await renderEmail(...)` and put `html` + `text` in the EMAIL payload.

## Verify
1. Contract and unit tests:
   ```bash
   npx vitest run tests/architecture/email-contract.test.ts tests/lib/email-templates.test.ts tests/lib/status-page-email-templates.test.ts tests/lib/authentication-email-template.test.ts
   ```
2. Visual check, Chromium + WebKit, light / dark / forced inversion, 375 / 640 / 1440px, with contrast assertions. Screenshots land in `test-results/email/`:
   ```bash
   npm run test:email:visual
   ```
3. Live preview: `npm run email:dev`, then open http://localhost:3030.
4. Real inboxes:
   ```bash
   docker compose -f deploy/compose/docker-compose.mailpit.yml up -d
   npm run email:send-test -- --to you@example.com      # then open http://localhost:8025
   SMTP_USER=… SMTP_PASS=… npm run email:send-test -- --smtp smtp.gmail.com:587 --to you@gmail.com,you@outlook.com
   ```
   Check Outlook for Windows desktop, new Outlook, Gmail web + iOS/Android, and Apple Mail, each in light and dark.
