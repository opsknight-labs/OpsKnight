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
  - Font Pairing: `'Space Grotesk'` for prominent titles, badges, and brand headers; Inter / system sans for body text.
- **Type Safety**: Strict TypeScript. No unchecked `any` types; define explicit interfaces or infer from Zod schemas.
- **Testing**:
  - Unit & Integration: Vitest (`tests/**/*.test.ts`).
  - End-to-End: Playwright (`playwright.config.ts`, `tests/e2e/`).

---

## 3. Brand Identity & Design System Standards

### Aesthetic Principles

- **Subtle, Elegant, and SRE-Focused**: Clean, high-contrast, modern engineering aesthetic.
- **No Intrusive Clutter**: Avoid loud promotional cards, excessive marketing copy, or noisy gamification banners in transactional alerts and operations interfaces.

### Official Brand Logo

- **Asset**: Background-less transparent logo (`/logo.png` or `public/logo.png`).
- **Vector Fallback**: Authentic red shield with knight headset SVG fallback for offline or blocked image scenarios.
- **Never Enclose in Dark Boxes**: Do not wrap the logo in an opaque dark square or squircle (`#0f172a`) in transparent or light-themed contexts.

### Official Brand Hyperlinks

- All OpsKnight brand logos, brand names, and footer attributions across email templates and public interfaces **must link to `https://opsknight.com/`**.
- In configurable components (`EmailStyles`), provide `brandUrl?: string` defaulting to `https://opsknight.com/`.

### Status Color Semantics

Always use semantic color themes across badges, headers, accent borders, and primary buttons:

- 🔴 **Critical / Triggered / High Urgency**: Crimson Red (`#881337` to `#e11d48`, border `#be123c`, bg `#fef2f2`).
- 🟠 **Elevated / Medium Urgency / Acknowledged**: Warm Amber / Orange (`#78350f` to `#d97706`, border `#d97706`, bg `#fffbeb`).
- 🟢 **Resolved / Operational / Success**: Emerald Green (`#047857` to `#059669`, border `#059669`, bg `#f0fdf4`).
- 🔵 **Standard / Low Urgency / Info**: Cobalt Blue (`#1e3a8a` to `#3b82f6`, border `#2563eb`, bg `#eff6ff`).
- 🟣 **On-Call Shifts & Rotations**: Royal Violet (`#4c1d95` to `#7c3aed`, border `#7c3aed`, bg `#f5f3ff`).

### Big-Screen & Responsive Scaling

Email templates and dashboard views must be responsive across all devices:

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

- **Template Structure**:
  - `EmailContainer`: Fluid table with Outlook MSO conditional tags and responsive media queries.
  - `EmailHeader`: Gradient header with hyperlinked transparent logo, brand name, and title.
  - `EmailContent`: Clean white content section with status badge, metrics table (`InfoCard`), and dedicated `Incident Description` box.
  - `Incident Description Card`: Framed in `#f8fafc` with status-colored 4px left border, `white-space: pre-wrap; word-break: break-word;`.
  - `EmailFooter`: Subtle attribution hyperlinked to `https://opsknight.com/`, notification settings, and unsubscribe links.
- **No Intrusive Promotions**: Transactional alert emails must remain clean, concise, and focused on operational telemetry.

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
