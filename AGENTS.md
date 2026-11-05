# OpsKnight Universal Agent Guidelines & Engineering Playbook

> **Scope**: This document is the single source of truth for all AI coding assistants (Antigravity, Claude Code, Cursor, Codex, GitHub Copilot) working in the OpsKnight repository. Adhere to these guidelines strictly.

---

## 1. Non-Negotiable Git & Pull Request Directive

- **Never Merge Directly**: NEVER execute `git merge`, `gh pr merge`, or enable direct auto-merging into `main` or `master`.
- **Feature Branches Only**: All changes must be developed on a dedicated, descriptive branch:
  - Features: `feat/<feature-name>`
  - Bug fixes: `fix/<bug-name>`
  - Performance: `perf/<optimization-name>`
  - Documentation: `docs/<topic-name>`
- **Pull Request Protocol**:
  1. Push branch to `origin`.
  2. Open a Pull Request with a clear summary, architecture rationale, and verification steps.
  3. Provide the Pull Request link directly to the user and **stop**. Always wait for explicit user review and approval.

---

## 2. Tech Stack & Architecture

- **Framework**: Next.js 15 with App Router (`src/app/`).
  - Use React Server Components (RSC) by default for data fetching and layout composition.
  - Mark client-interactive components explicitly with `'use client';`.
  - Use Server Actions (`'use server';`) in dedicated `actions.ts` files for state-mutating operations.
- **Database & ORM**: PostgreSQL managed via Prisma (`prisma/schema.prisma`).
- **Styling & Components**:
  - Tailwind CSS with customized color palettes.
  - Radix UI primitives (`@radix-ui/*`) wrapped in `src/components/ui/shadcn/`.
  - Lucide React (`lucide-react`) for icons.
  - Font Pairing: `'Space Grotesk'` for prominent titles, badges, and brand headers; Inter for body text (see "Typography" below).
- **Type Safety**: Strict TypeScript. No unchecked `any` types; define explicit interfaces or infer from Zod schemas.
- **Testing**:
  - Unit & Integration: Vitest (`tests/**/*.test.ts`).
  - End-to-End: Playwright (`playwright.config.ts`, `tests/e2e/`).

---

## 3. Brand Identity & Design System Standards

### Aesthetic Principles

- **Subtle, Elegant, and SRE-Focused**: Clean, high-contrast, modern engineering aesthetic.
- **No Intrusive Clutter**: Avoid loud promotional cards, excessive marketing copy, or noisy gamification banners in transactional alerts and operations interfaces.

### Typography

- **Inter** is the UI and body face; **Space Grotesk** is the display face for headings, badges and brand marks. Both are bundled with `next/font/local` in `src/app/layout.tsx` (no Google Fonts fetch at build or runtime).
- Never hard-code a font family. Use the tokens `--font-family-sans`, `--font-family-display` and `--font-family-mono` (`src/styles/foundation/variables.css`) in CSS, and `font-sans`, `font-display` and `font-mono` in Tailwind. `h1`–`h6` pick up the display face automatically.
- Transactional emails are the one exception: mail clients cannot load the bundled files, so email templates name `'Space Grotesk'` and Inter with system fallbacks.

### Official Brand Logo

- **Asset**: Background-less transparent logo (`/logo.png` or `public/logo.png`).
- **Vector Fallback**: Authentic red shield with knight headset SVG fallback for offline or blocked image scenarios.
- **Never Enclose in Dark Boxes**: Do not wrap the logo in an opaque dark square or squircle (`#0f172a`) in transparent or light-themed contexts.
- **Use the shared lockups**: `BrandLockup` (`src/components/layout/BrandLockup.tsx`) inside the app, `AuthBrand` (`src/components/auth/AuthBrand.tsx`) on sign-in, setup and other public pages. Both show the logo bare.

### Official Brand Hyperlinks

- All OpsKnight brand logos, brand names, and footer attributions across email templates and public interfaces **must link to `https://opsknight.com/`** (`OPSKNIGHT_BRAND_URL` in `src/lib/brand.ts`). Inside the authenticated app the lockup links home (`/`).
- In configurable components (`EmailStyles`), provide `brandUrl?: string` defaulting to `https://opsknight.com/`.

### Status Color Semantics

Always use semantic color themes across badges, headers, accent borders, and primary buttons. The values below are mirrored in `src/lib/design/status-palette.ts` (enforced by `tests/architecture/design-system-contract.test.ts`) and exposed to Tailwind as `status-{critical,elevated,ok,info,shift}` with `-deep`, `-border` and `-soft` shades, e.g. `bg-gradient-to-r from-status-critical-deep to-status-critical`. Success is always emerald (never Tailwind `green`); on-call layers never use incident-state hues.

- 🔴 **Critical / Triggered / High Urgency**: Crimson Red (`#881337` to `#e11d48`, border `#be123c`, bg `#fef2f2`).
- 🟠 **Elevated / Medium Urgency / Acknowledged**: Warm Amber / Orange (`#78350f` to `#d97706`, border `#d97706`, bg `#fffbeb`).
- 🟢 **Resolved / Operational / Success**: Emerald Green (`#047857` to `#059669`, border `#059669`, bg `#f0fdf4`).
- 🔵 **Standard / Low Urgency / Info**: Cobalt Blue (`#1e3a8a` to `#3b82f6`, border `#2563eb`, bg `#eff6ff`).
- 🟣 **On-Call Shifts & Rotations**: Royal Violet (`#4c1d95` to `#7c3aed`, border `#7c3aed`, bg `#f5f3ff`).

### Big-Screen & Responsive Scaling

Email templates and dashboard views must be responsive across all devices. The fixed container widths below apply to emails; the operations console stays fluid so dense views use the full display, and `.page-shell` gutters scale at the same 1440px / 1920px tiers (content is centred at a 2304px reading width on 2560px+ ultrawides):

- **Mobile (`<= 640px`)**: Full-width fluid containers, stacked action buttons (`padding: 14px 16px`), comfortable touch targets.
- **Desktop (`>= 1024px`)**: Scaled layout with `860px` container width.
- **27-inch / QHD Displays (`>= 1440px`)**: Expand to **1080px** width, `54px` padding, and `72px` logo.
- **Ultrawide & 4K Displays (`>= 1920px`)**: Expand up to **1180px** width, `60px` padding, and `76px` logo.

---

## 4. Backend, Security & RBAC Protocols

### Role-Based Access Control (RBAC)

- Always verify user capabilities in Server Actions and API endpoints using `getUserPermissions()` from `@/lib/rbac`.
- Check required capabilities explicitly:
  ```typescript
  const permissions = await getUserPermissions();
  if (!permissions.capabilities.includes('incident.create.all')) {
    throw new Error('Unauthorized');
  }
  ```

### Input Validation & Sanitization

- Every Server Action and API handler must parse arguments through a strict **Zod** schema (`z.object({...})`).
- Always sanitize URLs using `sanitizeUrl()` (allowing only `http:`, `https:`, `mailto:`, and `tel:`).
- Always escape dynamic HTML strings using `escapeHtml()` to prevent XSS.

### Encryption & Secrets

- Sensitive credentials (Slack bot tokens, webhook secrets, integration keys) must be encrypted using AES-256-GCM (`encryptWithKey` from `@/lib/encryption`).
- Never log plaintext secrets, passwords, or authentication headers in server logs.

### Multi-Tenant & Status Page Isolation

- Verify tenant / organization / status-page ownership on every query and mutation to guarantee complete isolation.

---

## 5. Database & Prisma Invariants

- **Transactions**: Multi-entity mutations (e.g. creating an incident, emitting an `IncidentEvent`, and creating notification intents) must be wrapped in `prisma.$transaction([...])`.
- **Deduplication**: Honor `dedupKey` indexing (`@@index([serviceId, dedupKey, status])`) to prevent alert storms and duplicate open incidents.
- **Immutable SLA Contracts**: Freeze SLA targets (`slaAckTargetMs`, `slaResolveTargetMs`, `slaTargetSource`) upon incident creation.
- **Migrations**: Always run `npx prisma migrate dev` or inspect `prisma/schema.prisma` before modifying database access code. Never use destructive flags (`--force` or `db push --accept-data-loss`) in shared environments.

---

## 6. Email & Transactional Notification Standards

Every email OpsKnight sends is a React Email template in `src/emails/templates/` built from the primitives in `src/emails/components.tsx`. No product code hand-writes email HTML; `tests/architecture/email-contract.test.ts` fails if it does.

- **Building blocks** (`src/emails/components.tsx`):
  - `EmailLayout`: document shell. Color-scheme meta, the three-layer dark-mode stylesheet, the Outlook `OfficeDocumentSettings` block and Segoe UI font fix, the 640px MSO ghost table, the card and the footer slot.
  - `HeaderBand`: status-coloured band at the top of every card. It holds the brand mark (logo + wordmark), eyebrow, title and subtitle. `bgcolor` = the tone's deep colour (Outlook), CSS gradient deep → base for everyone else. The transparent logo sits on a small white circular chip, so the red shield stays legible on crimson and every other tone (a light chip, never the forbidden dark box). OpsKnight emails link the mark to `https://opsknight.com/`; status-page emails show the page's own logo and name and link to the page.
  - `Badge`, `InfoTable`, `Callout` (the `#f8fafc` `surface="muted"` description card with a 4px status accent and `white-space: pre-wrap`), `Button`, `LinkFallback`, `EmailFooter`, `SubscriberFooter`.
- **Rendering**: `renderEmail(element, { text? })` from `src/emails/render.tsx` returns `{ html, text }`. Pass the hand-written `text` for security/auth emails; otherwise plain text is derived from the HTML.
- **Outlook (Word engine)**: tables only (no flex, grid, position, SVG); solid `bgcolor` under every gradient; bulletproof CTAs (VML `v:roundrect` + padded link); images are absolute https PNGs with explicit `width`/`height`/`alt` (no data: URIs).
- **Dark mode, three layers**, all generated from `dm-*` classes in `src/emails/styles.ts`:
  1. `@media (prefers-color-scheme: dark)`: Apple Mail, Outlook for Mac/iOS.
  2. `[data-ogsc]` (text) / `[data-ogsb]` (backgrounds): Outlook.com and new Outlook.
  3. Forced inversion (Gmail apps, Outlook for Windows): off-white/off-black surfaces and solid fills so inverted emails stay readable.
- **Colour**: status tones come from `src/emails/tokens.ts`, which mirrors "Status Color Semantics" above (pinned by the contract test). CTA/badge fills, callout text and body text all meet WCAG AA in both modes.
- **Width**: 640px base (and always 640px in Outlook desktop), scaling to 860 / 1080 / 1180px at the big-screen tiers in §3.
- **Size**: keep each email under 102 KB of HTML; Gmail clips anything larger and hides the footer and unsubscribe link.
- **Bulk subscriber email**: status-page fan-out renders once with `{{unsubscribe_url}}` / `{{start_time}}` / `{{…_section}}` placeholders substituted per recipient at send time, and sends RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post` headers pointing at `/api/status/subscriptions/unsubscribe/one-click/<token>`.
- **No Intrusive Promotions**: Transactional alert emails must remain clean, concise, and focused on operational telemetry.
- **Tooling**: `npm run email:dev` (live previews of every template with fixture props), `npm run test:email:visual` (Chromium + WebKit screenshots in light, dark and forced-inversion at 375–1440px with contrast checks), `npm run email:send-test -- --to you@example.com` (send the full set to Mailpit from `deploy/compose/docker-compose.mailpit.yml`, or to real inboxes via `--smtp`).

---

## 7. Quality Gate: Pre-Commit & Pre-Push Checklist

Before committing or pushing any code to a branch, always execute:

```bash
# 1. Type Check
npx tsc --noEmit

# 2. Lint Check (Ensure no unused imports or variables)
npx eslint <modified-files>

# 3. Unit Tests
npx vitest run <relevant-tests>
```

Zero errors and zero warnings are required before pushing.

---

## 8. CI Structure: Light Pull Requests, Full `main`

Pull requests run only the fast required gate. Everything heavy runs after merge on `main`, or on a PR that opts in. Keep new work inside this structure. The full inventory is in [`docs/CI_TEST_INVENTORY.md`](docs/CI_TEST_INVENTORY.md).

- **Every PR** runs `tests.yml` (static checks, unit tests, database integration in 4 shards, ingestion durability, database secret scripts, Next.js build, aggregated into the required `test` check) and `security.yml` (required `Security Summary`). The target is about 10 minutes.
- **`main`, tags and `workflow_dispatch`** also run browser E2E (`e2e.yml`), the Docker image build and image checks, runbook, swarm, deployment, MCP, SSO, SCIM, Teams, automation, integration certification, and SBOM.
- **`ci:full` label**: add it to a PR to run the heavy suites before merge. Add it when a PR touches deployment (`Dockerfile`, `deploy/**`, `agent/**`, `docker-entrypoint.sh`), runbooks, MCP, authentication/SSO/SCIM, `prisma/**`, or `package.json`/`package-lock.json`. Path filters still apply, so the label runs only the suites the diff affects.
- **Adding tests**: unit tests go in the `vitest.unit.config.ts` include paths, and database tests go in `tests/integration/`. Both are picked up and sharded automatically by `tests.yml`. Do not add browser, Docker, load or multi-service suites to `tests.yml`.
- **Adding a heavy workflow or job**: give it `push: branches: [main]` and `workflow_dispatch`. If it also needs a `pull_request` trigger, add `types: [opened, synchronize, reopened, labeled]` and guard the entry job with:
  ```yaml
  if: github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'ci:full')
  ```
  Do not add `push` triggers for `feat/**` or `fix/**` branches; they duplicate the PR run.
- **Required checks**: the ruleset requires exactly `test` and `Security Summary`. Never rename these jobs. When a job is added to or removed from the PR gate, update the `needs:` and status variables of the `test` job in `tests.yml`. When the database shard count changes, update the matrix, `--shard=N/<total>` and `DB_SHARDS` together.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
