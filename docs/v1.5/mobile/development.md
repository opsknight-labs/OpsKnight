---
order: 2
title: Mobile development
description: Contributor guide for the responsive mobile shell, shared incident UI, PWA lifecycle, push, caches, offline actions, and tests
---

# Mobile development

OpsKnight mobile is a responsive route group inside the main Next.js application. It is not a separate product, native application, or independent design system. The public URL prefix is `/m`, while desktop and mobile share the same authorization, incident lifecycle, design tokens, domain components, and server-side contracts.

## Architecture contract

Use this order of preference when building mobile functionality:

1. Reuse the canonical desktop/server component when it can respond cleanly to available width.
2. Compose shared `src/components/ui/shadcn/` primitives with the global semantic theme tokens.
3. Add a thin mobile presentation wrapper only when the interaction genuinely differs on a small touch screen.
4. Never duplicate domain mutations, authorization, incident lifecycle logic, status semantics, or integration capability checks for mobile.

The incident detail route is the reference pattern. Both `/incidents/[id]` and `/m/incidents/[id]` render `src/components/incident/IncidentDetailScreen.tsx`, so SLA, assignment, notes, watchers, Jira, War Room, custom fields, quick links, postmortems, permissions, and incident commands cannot drift between presentation routes.

## Source layout

- `src/app/(mobile)/m/` — mobile routes and the PWA shell.
- `src/app/(mobile)/m/mobile-shell.css` — safe-area, viewport, bottom-navigation, focus, touch-target, and responsive-shell behavior only.
- `src/app/(mobile)/m/mobile.css` — transitional compatibility rules for older mobile routes. Do not add new page-specific styling here; migrate existing pages toward shared components instead.
- `src/components/mobile/` — mobile-specific composition such as navigation, connectivity, installed-PWA controls, and touch-oriented lists.
- `src/components/incident/IncidentDetailScreen.tsx` — canonical responsive incident detail used by desktop and mobile.
- `src/components/ui/shadcn/` — canonical buttons, cards, dialogs, inputs, badges, and other primitives.
- `src/app/globals.css` — product theme, semantic status colors, spacing, radii, and desktop/mobile shared tokens.
- `src/app/manifest.ts` — install manifest with `/m` start URL.
- `next.config.ts` — PWA generation and Workbox cache policy.
- `public/custom-sw.js` — push display, notification actions, safe navigation, and offline replay imported by generated `/sw.js`.
- `src/lib/mobile-cache.ts` — principal-scoped encrypted last-known responder cache.
- `src/lib/offline-queue.ts` — principal-scoped, per-resource mutation queue in IndexedDB.

## Responsive design system

Desktop is the visual source of truth. Mobile uses the same product identity and semantic tokens, with a different composition for touch and constrained width.

Use the shared primitives first:

- `Button` for actions and links that behave like actions.
- `Card` for surfaces.
- `Badge` and semantic status components for state.
- the canonical `Dialog` for overlays. On phone widths it renders as a safe-area-aware bottom sheet; on larger widths it renders as a centered dialog.
- shared incident components for incident behavior and feature visibility.

Do not create another `MobileModal`, `MobileBottomSheet`, mobile-only status palette, page-specific button system, or parallel incident command implementation.

### Responsive acceptance rules

Every changed mobile screen must remain usable with:

- narrow phone widths down to approximately 320px;
- representative iPhone and Android portrait widths;
- landscape phone orientation;
- tablet widths;
- display cutouts and safe-area insets;
- the software keyboard open;
- light, dark, and system theme;
- long incident/service/user names;
- browser text scaling and accessibility zoom;
- reduced motion.

There must be no horizontal page overflow, clipped critical controls, content underneath bottom navigation, keyboard-covered form actions, or essential behavior available only through a gesture or color.

Critical touch controls should meet a 44px minimum target. Mobile inputs should remain at least 16px to avoid unwanted iOS Safari viewport zoom.

## Shell and navigation

`mobile-shell.css` owns the responsive shell. It intentionally does not define a second product palette.

The header and bottom navigation must use global theme tokens and safe-area insets. The bottom navigation is reserved for primary responder tasks; secondary destinations belong under **More**. Route state is centralized in `mobileNavItems.tsx`.

Avoid nested full-page scroll containers. Pages should normally allow the document/mobile content region to own vertical scrolling. Dialog content can scroll independently when the keyboard or viewport reduces available height.

## Home, incidents, and incident detail

These three surfaces are the reference design for future mobile migrations:

- **Home** prioritizes on-call state and incidents needing responder attention before secondary metrics.
- **Incidents** uses touch-friendly search/filter controls, discoverable actions, bounded server queries, and compact result navigation. Swipe actions are optional accelerators; critical ACK behavior must also be visibly tappable.
- **Incident detail** is shared with desktop through `IncidentDetailScreen` instead of a mobile feature fork.

When migrating Services, Schedules, Alerts, Analytics, Status, Teams, Users, Policies, Postmortems, or More, follow these reference surfaces rather than introducing another visual language.

## Authentication and responder storage

Mobile authentication uses the canonical login/session implementation. An installed standalone PWA can use the trusted-responder session policy, but authentication and authorization remain server-side concerns.

Responder cache and offline queue state are bound to the active principal and authentication generation. Account changes or security-generation changes must not expose or replay another principal's responder data.

Never put secrets, provider credentials, session tokens, or unbounded histories in browser responder caches.

## Offline mutations

The queue records explicit states including pending, sending, conflict, authentication-required, forbidden, failed, and succeeded outcomes. The UI must distinguish **queued** from **committed**.

Dependent commands are FIFO within the same incident/resource lane, while unrelated resource lanes may progress independently. Foreground and service-worker replay use atomic IndexedDB claim/lease ownership; server idempotency remains the second safety layer.

If authentication expires, eligible `AUTH_REQUIRED` work can resume only after authentication is restored for the same principal generation. A `403 FORBIDDEN` result is terminal and must not be revived by signing in again.

## PWA lifecycle

Production builds generate `public/sw.js`; Workbox imports `/custom-sw.js`. PWA generation is disabled in development and when `DISABLE_PWA=true`.

Do not edit generated `public/sw.js` directly. Change `next.config.ts` or `public/custom-sw.js`, run a production build, and verify the generated worker.

OpsKnight does not force a waiting worker to replace a responder's running client. A waiting update is activated explicitly. Reconnection synchronizes data and queued work without reloading an in-progress responder form.

Authenticated pages, APIs, and RSC payloads remain network-authoritative and are not treated as service-worker cache authority.

## Web Push

The device toggle obtains the active public VAPID key, registers the production service worker, creates a Web Push subscription from an explicit user gesture, and registers that subscription with OpsKnight. Server-side delivery uses the canonical Web Push configuration and safe outbound transport.

Push capability URLs are sensitive. Do not log raw endpoints. Subscription storage and delivery must continue to use the hardened endpoint identity/encryption boundary.

Test at minimum:

- missing or disabled provider configuration;
- permission allow and deny;
- subscription creation and server persistence;
- stale or replaced subscriptions;
- test delivery;
- foreground and background notification display;
- incident deep links;
- responder actions after session expiry;
- expired subscription cleanup.

Use HTTPS outside localhost.

## Add or change a route

1. Start with shared server/read models and shared UI primitives.
2. Add a page under `src/app/(mobile)/m/<feature>` only when a distinct mobile route is still useful.
3. Reuse canonical authorization and mutation contracts; hidden UI is never an authorization boundary.
4. Avoid new global or page-specific mobile CSS. Extend shared primitives or the shell only for genuinely cross-route responsive behavior.
5. Keep primary responder actions visible; gestures may accelerate them but may not be the only interaction.
6. Add unit/integration tests for behavior and Playwright coverage for responsive contracts.
7. Update this guide and the public mobile support documentation when the user-visible contract changes.

## Verification

Run the repository quality gates before opening a pull request:

```bash
npx tsc --noEmit
npx eslint <modified-files>
npx vitest run <relevant-tests>
```

For mobile/PWA work, also run the Playwright mobile projects and production PWA worker contract. Release acceptance should include an installed application on representative current iPhone/Safari and Android/Chrome devices.

The practical device checklist is:

1. 320px-class narrow viewport with no horizontal overflow;
2. representative iPhone portrait and landscape;
3. representative Android portrait and landscape;
4. tablet width;
5. software keyboard open on dialogs and forms;
6. large text/accessibility zoom;
7. light, dark, and system theme;
8. offline/reconnect with queued incident actions;
9. notification allow/deny, delivery, deep link, and action;
10. previous-worker to new-worker upgrade without losing in-progress responder state.
