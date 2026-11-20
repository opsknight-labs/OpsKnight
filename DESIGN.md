---
name: OpsKnight
description: Self-hosted incident response and on-call console, built to be read under pressure.
colors:
  surface-ground: '#f8fafc'
  surface-card: '#ffffff'
  surface-muted: '#f1f5f9'
  ink-foreground: '#0f172a'
  ink-muted: '#64748b'
  hairline: '#e2e8f0'
  action-slate: '#334155'
  action-slate-foreground: '#f8fafc'
  dark-ground: '#09090b'
  dark-card: '#121214'
  dark-muted: '#27272a'
  dark-foreground: '#f8fafc'
  dark-ink-muted: '#a1a1aa'
  dark-hairline: '#27272a'
  dark-ring: '#d4d4d8'
  brand-crimson: '#e11d48'
  critical-deep: '#881337'
  critical: '#e11d48'
  critical-border: '#be123c'
  critical-soft: '#fef2f2'
  elevated-deep: '#78350f'
  elevated: '#d97706'
  elevated-soft: '#fffbeb'
  ok-deep: '#047857'
  ok: '#059669'
  ok-soft: '#f0fdf4'
  info-deep: '#1e3a8a'
  info: '#3b82f6'
  info-border: '#2563eb'
  info-soft: '#eff6ff'
  shift-deep: '#4c1d95'
  shift: '#7c3aed'
  shift-soft: '#f5f3ff'
typography:
  display:
    fontFamily: 'Space Grotesk, Inter, system-ui, sans-serif'
    fontSize: '2.25rem'
    fontWeight: 800
    lineHeight: '2.5rem'
    letterSpacing: '-0.025em'
  headline:
    fontFamily: 'Space Grotesk, Inter, system-ui, sans-serif'
    fontSize: '1.75rem'
    fontWeight: 800
    lineHeight: '2.125rem'
    letterSpacing: '-0.02em'
  title:
    fontFamily: 'Space Grotesk, Inter, system-ui, sans-serif'
    fontSize: '1.0625rem'
    fontWeight: 600
    lineHeight: '1.625rem'
    letterSpacing: '-0.005em'
  body:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: '1.25rem'
    letterSpacing: '0'
  body-prose:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 400
    lineHeight: '1.5rem'
    letterSpacing: '-0.003em'
  label:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: '1.1rem'
    letterSpacing: '0.01em'
  data:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 500
    lineHeight: '1.25rem'
    fontFeature: 'tnum'
rounded:
  sm: '8px'
  md: '12px'
  card: '14px'
  lg: '16px'
  xl: '20px'
  full: '9999px'
  ui-lg: '0.75rem'
  ui-md: 'calc(0.75rem - 2px)'
  ui-sm: 'calc(0.75rem - 4px)'
spacing:
  '1': '0.25rem'
  '2': '0.5rem'
  '3': '0.75rem'
  '4': '1rem'
  '5': '1.25rem'
  '6': '1.5rem'
  '8': '2rem'
  '10': '2.5rem'
  '12': '3rem'
  '16': '4rem'
components:
  button-primary:
    backgroundColor: '{colors.action-slate}'
    textColor: '{colors.action-slate-foreground}'
    rounded: '{rounded.ui-md}'
    typography: '{typography.label}'
    height: '2.5rem'
    padding: '0.5rem 1rem'
  button-destructive:
    backgroundColor: '{colors.critical}'
    textColor: '{colors.action-slate-foreground}'
    rounded: '{rounded.ui-md}'
    height: '2.5rem'
    padding: '0.5rem 1rem'
  button-outline:
    backgroundColor: '{colors.surface-ground}'
    textColor: '{colors.ink-foreground}'
    rounded: '{rounded.ui-md}'
    height: '2.5rem'
    padding: '0.5rem 1rem'
  input:
    backgroundColor: '{colors.surface-card}'
    textColor: '{colors.ink-foreground}'
    rounded: '{rounded.ui-md}'
    height: '2.5rem'
    padding: '0.5rem 0.75rem'
  card:
    backgroundColor: '{colors.surface-card}'
    textColor: '{colors.ink-foreground}'
    rounded: '{rounded.ui-lg}'
    padding: '1rem'
  status-badge-critical:
    backgroundColor: '{colors.critical-soft}'
    textColor: '{colors.critical-deep}'
    rounded: '{rounded.full}'
    padding: '0.125rem 0.5rem'
---

# Design System: OpsKnight

Tokens live in one file, `src/styles/foundation/tokens.css`, which loads first. Tailwind reads the same
variables (`tailwind.config.ts`), and `tests/architecture/design-tokens-contract.test.ts` keeps the two from
drifting. Status hues live in `src/lib/design/status-palette.ts`. Who uses OpsKnight and why is in
[PRODUCT.md](PRODUCT.md). The rules for agents are in [AGENTS.md §3](AGENTS.md#3-brand-identity--design-system-standards).

## Overview

**Creative North Star: "The Quiet Control Room"**

OpsKnight is used by people who were just paged. The screen should feel calm and dense: neutral slate and
zinc surfaces, firm hierarchy, and colour only where it means something. A responder should find the
incident, its state, its owner and the next action in seconds without learning anything new. Consistency
matters more than novelty here. Every list, header, filter, table, empty state and dialog uses the same
patterns, so once you know one screen you can work the rest.

The identity is in the type and the signal colours. Space Grotesk sets page titles and brand marks. Inter
carries everything you read and act on. The crimson of the logo doubles as the critical signal, so it
never appears as decoration. Light and dark are both first-class. Dark is a neutral zinc treatment, not a
coloured theme. The sidebar and top bar are always dark (the inverse surface), so the console looks the
same in both themes.

This is impeccable's **Operate** mode on the console (`/`, `(app)`) and the mobile responder app (`/m`).
Documentation and public status pages are **Read** surfaces: same tokens, wider measure, fewer controls.

**Key Characteristics:**

- Neutral surfaces, semantic colour: status hues carry state and are never used as ornament.
- One fixed rem type scale, density driven by the root size (no fluid type).
- Flat at rest: hairline borders separate surfaces, and shadows only lift things that float.
- Same component vocabulary on every screen: PageHeader → FilterBar → DataTable / EmptyState / ErrorState.
- Motion is 150–200 ms and only shows a change of state.

## Colors

The palette is restrained: slate/zinc neutrals with five semantic status ramps on top. Every role has a
light and a dark value, and components use the role through Tailwind, never the hex.

### Primary

- **Action Slate** (light `#334155`, dark `#f8fafc`; `bg-primary` / `text-primary-foreground`): filled
  primary buttons, the selected segment, focus rings in light mode. In dark it turns near-white with dark
  text, so the primary action stays the highest-contrast element.
- **Brand Crimson** (`#e11d48`): the logo, the brand lockup and the critical status. It is never used as
  a generic accent or button colour.

### Neutral

- **Ground** (`#f8fafc` / dark `#09090b`; `bg-background`): app canvas behind cards.
- **Card** (`#ffffff` / dark `#121214`; `bg-card`, `bg-popover`): cards, tables, popovers, dialogs.
- **Muted** (`#f1f5f9` / dark `#27272a`; `bg-muted`, `bg-accent`, `bg-secondary`): hover rows, subtle fills, secondary buttons.
- **Foreground** (`#0f172a` / dark `#f8fafc`; `text-foreground`): primary text.
- **Muted Foreground** (`#64748b` / dark `#a1a1aa`; `text-muted-foreground`): secondary text, meta, placeholders.
- **Hairline** (`#e2e8f0` / dark `#27272a`; `border-border`, `border-input`): every divider and control
  stroke, and the default `border` colour of every element.
- **Ink ramp** (`ink-50…950`): a theme-aware neutral scale. It equals Tailwind `slate` in light and is
  inverted zinc in dark. Use it where a role token is too coarse, e.g. `text-ink-600`, `bg-ink-100`.
- **Inverse surface** (`.ok-inverse-surface`): sidebar, top bar and `DetailHeroBanner` are dark in both
  themes. The class pins light-on-dark token values inside them.
- **High contrast**: under `prefers-contrast: more`, borders and muted text get firmer automatically.

### Status (semantic)

Defined in `src/lib/design/status-palette.ts` and exposed as `status-<tone>`, `-deep`, `-border`, `-soft`:

| Tone     | Means                                  | Deep → Base           | Border    | Soft (light) |
| -------- | -------------------------------------- | --------------------- | --------- | ------------ |
| critical | Triggered, high urgency, errors        | `#881337` → `#e11d48` | `#be123c` | `#fef2f2`    |
| elevated | Acknowledged, medium urgency, warnings | `#78350f` → `#d97706` | `#d97706` | `#fffbeb`    |
| ok       | Resolved, operational, success         | `#047857` → `#059669` | `#059669` | `#f0fdf4`    |
| info     | Low urgency, snoozed, informational    | `#1e3a8a` → `#3b82f6` | `#2563eb` | `#eff6ff`    |
| shift    | On-call shifts and rotations           | `#4c1d95` → `#7c3aed` | `#7c3aed` | `#f5f3ff`    |

Pastel fills need a dark pair: `bg-rose-50 dark:bg-rose-500/10`, `border-rose-200 dark:border-rose-500/30`,
`text-rose-700 dark:text-rose-300` (same pattern for amber, emerald, blue, violet).

**The Signal Rule.** A status hue always means its status. If something is red, it is critical. Success
is always emerald (never Tailwind `green`), and on-call is always violet.

**The Pair Rule.** No bare `bg-white`, `slate-*`/`gray-*` neutral or hex colour without a dark
counterpart. Prefer role tokens or `ink-*`, which switch with the theme.

### Legacy palette

`src/styles/foundation/variables.css` + `variables-dark.css` still define hex variables (`--bg-*`,
`--text-*`, `--border`, `--badge-*`, `--gradient-*`) for older CSS. Each is defined once per theme. New
code must not use them.

## Typography

**Display Font:** Space Grotesk (fallback Inter, system-ui)
**Body Font:** Inter (fallback -apple-system, Segoe UI, system-ui)
**Mono:** ui-monospace / SF Mono (code, IDs, payloads; not as decoration)

**Character:** Inter is a neutral workhorse for dense data. Space Grotesk's geometric edge marks page
titles, badges and the brand, and nothing else.

### Scale

One rem scale, shared by CSS (`--font-size-<step>`) and Tailwind (`text-<step>`). Each step also sets its
line height and tracking. From `sm` up, each step is about 1.13–1.2× the previous. `4xl`/`5xl` are display
steps.

| Step   | rem    | px @16 | Line height | Typical use                                              |
| ------ | ------ | ------ | ----------- | -------------------------------------------------------- |
| `2xs`  | 0.6875 | 11     | 1rem        | Badge text, chart ticks                                  |
| `xs`   | 0.75   | 12     | 1.1rem      | Meta, captions, table headers, helper text               |
| `sm`   | 0.8125 | 13     | 1.25rem     | **Default UI text**: table cells, inputs, buttons, menus |
| `base` | 0.9375 | 15     | 1.5rem      | Prose, descriptions, long-form                           |
| `lg`   | 1.0625 | 17     | 1.625rem    | Section and dialog titles                                |
| `xl`   | 1.25   | 20     | 1.75rem     | Card hero titles, mobile page titles                     |
| `2xl`  | 1.5    | 24     | 2rem        | Page titles (mobile), detail headers                     |
| `3xl`  | 1.75   | 28     | 2.125rem    | Page titles (desktop)                                    |
| `4xl`  | 2.25   | 36     | 2.5rem      | Display numerals (KPIs, wallboard)                       |
| `5xl`  | 3      | 48     | 3.25rem     | Wallboard and empty-state hero numerals only             |

Unstyled text inherits `--body-font-size` (1rem, the density root). UI text should still set a step
explicitly. Avoid arbitrary sizes (`text-[11px]`); the closest step is almost always right.

### Hierarchy

- **Display** (800, `4xl`): KPI and wallboard numerals.
- **Headline** (800, `2xl` → `3xl` from `sm`): the page `h1` in PageHeader. Space Grotesk via `h1–h6`.
- **Title** (600, `lg`/`base`): card, section and dialog titles.
- **Body** (400, `sm`; prose `base` at 65–75ch): everything you read.
- **Label** (500–600, `xs`/`sm`): form labels, column headers, nav items, button text (500).
- **Data** (500, `sm`, `tabular-nums`): counts, durations, timestamps, IDs, metrics.

### Weight

Body text is **400**. Emphasis is opt-in: `font-medium` (500) for interactive text, row primary text and
nav labels; `font-semibold` (600) for titles and labels; `font-bold`/`font-extrabold` (700/800) for
headlines and display numerals only. Never rely on an inherited weight for hierarchy.

**The Tabular Rule.** Numbers that sit in columns, change live or get compared use `tabular-nums`:
counts, MTTA/MTTR, SLA timers, durations, percentages, timestamps, pagination ranges. Digits must not
shift width while a timer ticks.

## Layout

- **Shell**: always-dark sidebar (240px; 216px on laptops; 208px on small laptops; 64px collapsed;
  off-canvas on phones) + 56px top bar + fluid content (`.page-shell`). Gutters: 12/16px by default,
  16/24px from 1440px, 20/32px from 1920px, and content centred at 2304px on 2560px+ ultrawides.
- **Spacing**: 4px base (`--spacing-1…24`, the same steps as Tailwind). Tight inside a group (`gap-2`,
  `gap-3`), generous between groups (`space-y-4`, `space-y-6`). Leave more space above a heading than below it.
- **Page rhythm**: PageHeader → FilterBar → content. One primary action per page, top right.
- **Breakpoints**: 640 / 768 / 1024 / 1280 / 1536px (Tailwind defaults). The mobile app (`/m`) is a
  separate shell, not a squeezed console.

### Density

The root font size is the density root. Every rem (type, spacing, Tailwind radius) scales with it, and
px tokens (legacy radius, shadows, hairlines) stay fixed.

| `html[data-density]`      | Phones (≤768px) | Small laptops (≤1280w or ≤740h) | Laptops (≤1536w or ≤860h) | Large displays |
| ------------------------- | --------------- | ------------------------------- | ------------------------- | -------------- |
| absent / `auto` (default) | 16px            | 14px                            | 14.4px                    | 16px           |
| `compact`                 | 16px            | 14.4px                          | 14.4px                    | 14.4px         |
| `comfortable`             | 16px            | 16px                            | 16px                      | 16px           |

Phones always get 16px so iOS never zooms a focused field, and only fine pointers (mouse, trackpad)
shrink, so a phone or tablet in landscape keeps 16px fields and 44px targets. The default reproduces the console's historical
sizing. Setting the attribute on `<html>` pins a density; there is no preference UI yet. Defined in
`tokens.css` (`--density-scale`).

## Elevation & Depth

The base is tonal layering: ground → card → muted, separated by hairline borders. Shadows are structural
and sparse: resting cards get at most `shadow-sm`, and floating layers (menus, popovers, dialogs, toasts)
get `md`–`xl`. Dark mode uses deeper, near-black shadows (35–45% black) because zinc surfaces swallow soft
ones.

### Shadow Vocabulary

- **xs** (`0 1px 2px rgba(0,0,0,.05)`): pressed chips, inline controls.
- **sm** (`0 1px 3px rgba(0,0,0,.07), 0 1px 2px -1px rgba(0,0,0,.07)`): resting cards when a border alone is too faint.
- **md** (`0 4px 6px -1px rgba(0,0,0,.08), 0 2px 4px -2px rgba(0,0,0,.06)`): dropdowns, popovers, hover-lift.
- **lg / xl** (`0 10px 15px` / `0 20px 25px`, 10% black): dialogs, sheets, command palette.
- **2xl** (`0 25px 50px rgba(0,0,0,.15)`): full-screen overlays only.

### Z-index

`--z-dropdown` 1000 · `--z-user-menu` 1010 · `--z-sticky` 1020 · `--z-fixed` 1030 · `--z-modal-backdrop`
1040 · `--z-modal` 1050 · `--z-popover` 1060 · `--z-tooltip` 1070. Radix portals already stack correctly,
so don't hand-tune z-index on overlays.

**The Flat-at-Rest Rule.** Surfaces are flat at rest. A shadow means something floats above the page.

## Shapes

Gently rounded and consistent. Components use the Tailwind radius, which comes from `--ui-radius`
(0.75rem): `rounded-lg` for cards, dialogs and panels, `rounded-md` for buttons and inputs, `rounded-sm`
for chips inside controls, and `rounded-full` for status pills, avatars and dots. The px tokens
(`--radius-sm` 8px, `--radius-md` 12px, `--radius` 14px, `--radius-lg` 16px, `--radius-xl` 20px) exist for
legacy CSS and inline styles. Borders are 1px hairlines in `border-border`.

**The Status Rail (signature).** Incident and service rows carry a 4px rounded status rail on the left
edge (`data-status-rail`, `toneClasses(tone).solid`), which widens on hover, focus and selection, plus a
tone-tinted hover border. It's reserved for status-bearing list rows. Don't use thick coloured borders on
callouts or plain cards; use a badge, a dot or a tinted surface there.

## Components

Phases of the UI programme converge every screen on this vocabulary. Prefer the shared component over a
local copy. If a variant is missing, add it to the shared component.

Shared patterns live in `src/components/patterns/` (barrel: `@/components/patterns`); primitives live
in `src/components/ui/shadcn/` and are canonical. The older `src/components/ui/{Button,Badge,Card,Input,
Modal,Select}.tsx` are thin compatibility wrappers over shadcn that keep their original props
(`variant="primary"`, `isLoading`, `leftIcon`, `label`/`error`…). Don't add call sites to them; use shadcn.

### PageHeader

`PageHeader` (`patterns/PageHeader.tsx`) is the page `h1` on the always-dark hero surface. It is a
cleaner API over `DetailHeroBanner`, which stays the implementation, so both render identically.

- **Use for** every list and detail page header. Settings pages use `SettingsPageHeader`
  (`settings/layout/SettingsPageHeader.tsx`): the same props plus `trail` (crumbs after the settings
  page) and `hideSearch`. It derives the breadcrumb row (Settings › Section › Page) from
  `settings/navConfig.ts` and puts the settings-only search on the right of it.
- **Props:** `title`, `description`, `icon` (a lucide component, drawn in the standard tile, or any
  node), `badges`, `primaryAction` (one, rightmost), `secondaryActions`, `stats` (`DetailStatItem[]`,
  `statsPlacement` inline/bottom), `breadcrumbs` (`{label, href?}[]` → `<Breadcrumbs>` nav, last item
  `aria-current="page"`, or a custom node), `alert`, `eyebrow` (legacy `tag`).
- **Eyebrow (signature).** Every page band carries a short section line above the title ("Real-Time
  Response Center", "Infrastructure Directory", "Incident Learning"), rendered as tracked uppercase
  micro-text. Settings pages default to "Workspace Settings". Write it in Title Case and keep it to
  2–5 words; the band uppercases it.
- **One structure on every page.** Top: icon tile, eyebrow and badges, `h1`, one-line description, actions
  top-right (below the title on phones). Bottom strip: `stats`, always under a divider, left-aligned as a
  compact wrapping group (two columns on phones). `statsPlacement` is deprecated and ignored, so headers
  never switch layout between pages. Stats with `href` are filters: they get a hover state, `active`
  marks the current one (`aria-current`), and the label is announced as "Filter by …" with its value.
- **Stat content:** label (micro-label), value (`text-base`, tabular), optional icon and `subtext`.
  Long values truncate with the full text in `title`; extra stats wrap rather than scroll.
- **On the dark surface** default outline buttons and `text-primary` badges disappear. Use the exported
  `pageHeaderActionClass` / `pageHeaderBadgeClass`.
- `DirectoryPageHeader` and `RunbookPageHeader` now render through `PageHeader` (deprecated wrappers).

### FilterBar

`FilterBar` (`patterns/FilterBar.tsx`) is the filter card under the header.

- **Props:** `title`/`description`/`icon` (optional title row; without it the bar is one compact row),
  `search` (`{value, onChange, placeholder, label, debounceMs}`; debounced, with a clear button),
  `filters` (slots, usually `<FilterField label htmlFor>` wrapping a select), `chips`
  (`<FilterChip active onClick>` toggles with `aria-pressed`, or `<FilterChip onRemove>` active-filter
  tokens), `hasActiveFilters` + `onClearAll` (+ `clearLabel`) for "Clear all", `advanced` content in a
  collapsible "Advanced filters" section (`advancedActiveCount`, `defaultAdvancedOpen`), `actions`.
- **OpsKnight look (signature):** list pages pass a `title` ("Filter incidents") and a one-line
  `description`; the title row shows a funnel tile (or `icon`). `FilterField` takes an `icon` and renders
  its label as uppercase micro-text with that icon. Status quick filters use `<FilterChip tone icon>`
  (`critical`, `elevated`, `ok`, `info`, `shift`): the icon carries the tone, hover tints, and the active
  chip fills with the tone. List sections under the filter card use the same micro-label for their
  heading ("Incident list", "Service directory").
- Keep filter state in the URL. On phones it stacks; the mobile app keeps its sheet.
- `SearchFilterBar` delegates to it (single row, "Reset" label).

### DataTable

`text-sm` cells; column headers `text-xs font-medium text-muted-foreground`; the primary cell
(title/name) is `font-medium text-foreground` and links to the detail page. Rows hover to `bg-muted/50`.
Numbers and times are `tabular-nums`, right-aligned when compared. Pagination comes from
`TablePaginationFooter`. On phones, use a card list, not a horizontally scrolling table.

### StatusBadge and SeverityBadge

Pills (`rounded-full`, `text-2xs`/`text-xs`, `font-semibold`, sentence case) with an **icon and a
label**, on the tone's soft fill with deep text and the dark pair (`/15` fill, `-300` text). Tones come
only from `status-palette.ts`; the class recipes are in `patterns/status-tone.ts` (`toneClasses()`,
which also gives the solid dot/accent-bar, hover border and left-rule colour for rows).

- **`StatusBadge`** — `status` (TRIGGERED/OPEN → "Triggered", ACKNOWLEDGED, SNOOZED, RESOLVED;
  SUPPRESSED and unknown values are neutral), `size` `xs|sm|md`, `label` override, `live` (pulsing
  halo, only for live unacknowledged incidents; `motion-safe`).
- **`SeverityBadge`** — `urgency` (HIGH/MEDIUM/LOW; `abbreviate` → "Med") or `priority` (P1–P5 via
  `priorityTone()`; `showLabel` → "P1 · Crisis"), `size`, `hideIcon` (densest rows only, e.g. the live
  dashboard). Screen readers hear "High urgency" / "Priority P1".
- Neither sets `data-badge`, so Windows forced colours repaint them (border + icon + text survive).
- **`variant="solid"`** (both badges) fills the pill with the tone (`toneClasses().filled`, AA text on
  the fill). Use it for a row's primary signals (incident status and priority on list rows, service
  health), and keep secondary signals (urgency, tags) soft, so the eye lands on the solid pair first.
- `PriorityBadge`, `IncidentStatusBadge` and `IncidentUrgencyBadge` delegate to these. The generic
  `incident/StatusBadge` remains for non-incident states (status pages, postmortems).

### RelativeTime

`<RelativeTime date />` (`patterns/RelativeTime.tsx`) renders `<time dateTime>` with `tabular-nums` and
the absolute time + timezone (the user's, from `TimezoneContext`) in `title`.

- **Props:** `date`, `format` (`short` "5m ago" / "in 2h" / "Nov 3" after a week — default; `long`
  "5 minutes ago"; `narrow` "5m" ages for dense rows), `now` (an external clock; the component then
  starts no timer, e.g. the live dashboard's tick), `timeZone` override, `fallback`.
- Updates itself on a shared interval (30 s under an hour, 5 min under a day, then hourly), so a list
  of rows runs at most three timers and only the `<time>` re-renders. `formatRelativeLabel()` is the
  pure formatter.

### EmptyState

`EmptyState` (`patterns/EmptyState.tsx`): `icon`, `title` (one line), `description` (what this area is
for), `primaryAction` (alias `action`), `secondaryAction`, `helpLink` (`{href, label}`; external links
open in a new tab), `variant` `dashed|card|simple`, `size`, `headingLevel`. A filtered-empty state offers
"Clear filters" as its action. Never just "No data". `ui/EmptyState` re-exports it.

### ErrorState

`ErrorState` (`patterns/ErrorState.tsx`, `role="alert"`): `title` naming the problem, `message` with the
recovery, `onRetry` (+ `retryText`, `isRetrying` spinner), `onGoBack` or `backHref`/`backLabel`,
`errorCode` (request/correlation ID, selectable), `details` in a closed "Technical details" disclosure,
`variant` `page` (route-level) or `inline` (inside a card). `ui/ErrorState` wraps it with the old props.

### Skeleton

Loading shows skeletons in the shape of the final layout, not a spinner in the middle. Spinners are
allowed only inside buttons (`loading` on the shadcn Button) and small inline refreshes. Presets in
`patterns/Skeletons.tsx`, each one `role="status"` region with a single "Loading…" label:
`TableRowsSkeleton` (`rows`, `columns`, `showHeader`), `CardGridSkeleton` (`cards`, `columns`),
`DetailPageSkeleton` (dark header band, tabs, main column + rail). Building blocks: shadcn `Skeleton`,
`PageLoadingSkeleton`, `DetailHeroBannerSkeleton`.

### Mobile (`/m`)

The responder app is its own shell (`src/app/(mobile)/m/mobile-shell.css`): app bar (route title as
the `h1`, 44px back/search/status actions) → content → bottom nav, each a fixed grid row with
safe-area insets. Pages compose `src/components/mobile/MobileList.tsx` instead of local markup:
`MobileListMeta` (count line), `MobileSection` (h2 + "View all"), `MobileListCard`/`MobileListRow`
(divided card of ≥56px rows), `MobileIncidentRow`, `MobileDetailHeader` (detail `h1`, badges, facts)
and `MobileToneBadge` (palette pill for non-incident states). Loading uses the presets in
`MobileSkeleton.tsx`, errors `MobileRouteError`/`MobileUnavailableState` (ErrorState + Retry).
Forms end in a sticky `.mobile-action-bar`; filters open as a bottom sheet. Inputs are 16px and every
action is at least 44×44px, including in landscape (the shell keeps a 16px root on touch devices).
The PWA manifest uses the brand dark `#09090b` for `theme_color` and `background_color` (a manifest
cannot vary by scheme); the runtime `<meta name="theme-color">` follows the active theme.

### Settings pages

- **Frame:** `SettingsShell` gives the page width and gutters; each page renders `SettingsPageHeader`
  then its content. In-page tabs stay under the header. Loading is `SettingsPageSkeleton`
  (`form` / `table` / `cards`), errors are the route's `ErrorState` boundary.
- **Sections:** `SettingsSection` is a labelled `section` card: `h2` title, one-line description,
  right-aligned `action`, content and an optional muted `footer` (save bar). `tone="danger"` frames
  irreversible actions. Rows inside use `SettingsRow` (label + help text left, control right; `error`
  shows inline validation, and `settingsRowDescribedBy()` gives the control its `aria-describedby`).
- **Feedback:** saves confirm with `notify` toasts; keep only field errors inline. Destructive
  actions (delete, revoke, unsubscribe, archive) always open `DeleteConfirmDialog` / `AlertDialog`
  that names the object and the consequence.
- **Integrations:** `IntegrationStatusBadge` (`connected` / `not_connected` / `error`, `onDark` for
  the header) is the one state vocabulary for the hub (`/settings/integrations`), the settings home
  and each provider page.

### Log tables

Audit log, Event logs and System logs share `components/audit/LogTable.tsx`: `FilterBar` with
labelled `FilterField`s → `LogTableCard` (table or `EmptyState`, with "Clear filters" when filtered)
→ `LogPagination` (`TablePaginationFooter` in a labelled `nav`). Times are `LogTimestamp`
(`RelativeTime` plus the absolute time underneath), identifiers are `MonoId` (monospace, named copy
button). Rows are not click targets; open details with an explicit button. Loading is
`LogPageSkeleton`.

### Buttons

- **Shape:** `rounded-md`, height `h-10` (2.5rem; `sm` `h-9`, `lg` `h-11`, icon 2.5rem square; all rem, so they follow density), `text-sm font-medium`, 16px icons with `gap-2`. On phones, controls are at least 44px tall.
- **Variants:** `default` (Action Slate, the one primary action), `destructive` (irreversible actions, always confirmed), `outline` (secondary), `secondary`, `ghost` (toolbar/tertiary), `link`.
- **States:** hover darkens/tints, `focus-visible` 2px ring + 2px offset, `active:` deepens the fill, `disabled:opacity-50`, and `loading` shows a centred spinner while keeping the label's width (and sets `disabled` + `aria-busy`).
- Source: `src/components/ui/shadcn/button.tsx`.

### Forms

Label above the field (`text-sm font-medium`), helper or error text below (`text-xs`; errors use
`text-destructive` and `aria-describedby`). Inputs/selects/textareas share the same height, `rounded-md`,
`border-input`, `bg-background` and focus ring. Validate on blur/submit and keep the user's input on error.

### Dialogs

For confirmations and short focused tasks only. Prefer inline editing or a sheet. Title (`lg`, 600),
body, footer actions right-aligned (cancel = outline, confirm = default/destructive). Destructive
confirmations use `DeleteConfirmDialog` / shadcn `AlertDialog`, never `window.confirm()`. Feedback goes
through `notify` from `@/lib/toast`, never `alert()`.

### Motion

`--transition-fast` 150ms for hover/press/colour, `--transition-base` 200ms for expand/collapse and
popovers, `--transition-slow` 300ms only for sheets/drawers. `--transition-slower` 500ms and the ambient
keyframes are for decorative, non-blocking effects (login, wallboard). Easing: `--ease-out` for entering,
`--ease-in` for leaving. Motion only shows state: no page-load choreography. Everything honours
`prefers-reduced-motion: reduce`.

### Accessibility

- Visible focus on everything: `focus-visible:ring-2 ring-ring ring-offset-2` (global fallback outline in
  `globals.css`). Never `outline: none` without a replacement.
- Icon-only buttons have an `aria-label`. Decorative icons are `aria-hidden`.
- No `div` with `onClick` unless it has a role, `tabIndex` and key handling. Use a button or link. Never
  nest interactive elements.
- Touch targets are at least 44×44px on mobile.
- Contrast is AA: body text ≥ 4.5:1, large text and UI strokes ≥ 3:1, in both themes. Status text on
  soft fills uses the deep shade (light) or the `-300` shade (dark).
- Colour is never the only signal: status also has a label or icon.
- Windows forced colours keep working (no global `forced-color-adjust: none`).

## Do's and Don'ts

### Do:

- **Do** use role tokens (`bg-card`, `text-muted-foreground`, `border-border`) or `ink-*`. Both themes
  then work by construction.
- **Do** take every size from the scale (`text-xs`/`sm`/`base`…) and every radius from `rounded-*`.
- **Do** set weights explicitly: 400 body, 500 interactive/primary row text, 600 titles, 800 headlines.
- **Do** use `tabular-nums` on every number that is compared or ticks.
- **Do** build each list page as PageHeader → FilterBar → DataTable, with EmptyState, ErrorState and
  Skeleton covering the other three states.
- **Do** keep the sidebar, top bar and hero banners on `ok-inverse-surface`.

### Don't:

- **Don't** redefine a token outside `tokens.css`. Aliases (`--x: var(--token)`) only.
- **Don't** use arbitrary sizes (`text-[10px]`) or hex colours in components.
- **Don't** use crimson, amber, emerald, blue or violet as decoration. They mean status.
- **Don't** show a centred spinner for page loads, or "No data" without a next step.
- **Don't** animate longer than 250ms for a state change, or animate on page load.
- **Don't** use Tailwind `green` for success, or incident hues for on-call layers.
- **Don't** wrap the logo in a dark box (see AGENTS.md "Official Brand Logo").
- **Don't** add gradient text or decorative glass. (Band eyebrows and section micro-labels are part of
  the identity; don't sprinkle extra kicker labels inside cards.)
