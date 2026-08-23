---
order: 2
title: Mobile development
description: Contributor guide for mobile routes, PWA generation, push, caches, offline actions, and tests
---

# Mobile development

The mobile application is a route group inside the main Next.js application, not a separate project or native application. Its public URL prefix is `/m`.

## Source layout

- `src/app/(mobile)/m/` — mobile pages and layout.
- `src/components/mobile/` — mobile shell, navigation, lists, actions, preferences, and shared UI.
- `src/components/mobile/mobileNavItems.tsx` — bottom navigation and routes grouped under **More**.
- `src/app/manifest.ts` — install manifest with `/m` start URL.
- `next.config.ts` — PWA generation and Workbox configuration.
- `public/custom-sw.js` — push display, click navigation, and background-sync handlers imported by generated `/sw.js`.
- `src/lib/mobile-cache.ts` — encrypted last-known list cache in browser `localStorage`.
- `src/lib/offline-queue.ts` — selected request queue in IndexedDB.
- `src/lib/push.ts` — server-side Web Push delivery.

The application currently uses Next.js App Router, NextAuth, `@ducanh2912/next-pwa`, and `web-push`. Check `package.json` for the exact version in the branch you are changing.

## Add or change a route

1. Add a `page.tsx` under `src/app/(mobile)/m/<feature>`.
2. Use the mobile layout and components instead of creating another application shell.
3. Add a bottom-navigation item only for a primary responder task. Put secondary routes in `MobileMoreContent` and include the root in `MOBILE_MORE_ROUTES` so the **More** item receives active state.
4. Enforce authentication and authorization on the server. A mobile link or hidden control is not a permission check.
5. Decide explicitly whether the route is read-only or has mobile mutations. Point users to the desktop editor when mutation is intentionally absent.
6. Add component tests and, for database behavior, integration tests.
7. Update the [mobile support matrix](./README) when the user-visible contract changes.

Do not claim offline support because a page happened to render from the service-worker cache. Offline support is documented only when the route's client code deliberately reads a defined last-known cache or queues a defined mutation.

## PWA lifecycle

Production builds generate `public/sw.js`. Workbox imports `/custom-sw.js`, registers the worker, skips waiting, reloads on reconnection, and uses `/m` as the cached start URL. PWA generation is disabled when `NODE_ENV=development` or `DISABLE_PWA=true`.

Because the worker is generated, do not edit `public/sw.js` as source. Change `next.config.ts` or `public/custom-sw.js`, run a production build, and inspect the generated result.

When changing worker behavior, test upgrade from the previous deployed worker as well as a fresh install. A browser can keep an old worker or old cached resources until activation and reload complete.

## Web Push

The mobile toggle obtains the public VAPID key from `/api/system/vapid-public-key`, registers `/sw.js` at scope `/`, creates a Push API subscription, and stores it through the user push-subscription route. The server uses `src/lib/push.ts` to send encrypted Web Push messages.

For the environment fallback, configure a matching base64url key pair:

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=public_base64url_key
VAPID_PRIVATE_KEY=private_base64url_key
VAPID_SUBJECT=mailto:admin@example.com
```

The database-backed provider configuration can supply the active public key instead. Never expose `VAPID_PRIVATE_KEY` to client code or commit it.

Generate a development key pair with:

```bash
npx web-push generate-vapid-keys
```

Test denied permission, missing key, invalid key, subscription replacement, expired subscription cleanup, notification display, and deep-link navigation. Use HTTPS outside `localhost`.

## Last-known data cache

`mobile-cache.ts` encrypts a timestamped payload with browser Web Crypto and stores it in `localStorage`. Current clients use it for incident, notification, service, schedule, and team lists. Service and team search queries have distinct cache keys.

The key material is part of the client application. Treat this as defense against casual storage inspection, not protection against a user or script that can execute in the application origin. Keep cached payloads minimal and never add provider secrets, API keys, session tokens, or unbounded histories.

When storage quota is exhausted, the helper removes the oldest timestamped entries and retries once. Callers must tolerate an empty, unreadable, evicted, or stale cache.

## Offline request queue

`offline-queue.ts` stores method, URL, headers, body, and creation time in the `opsknight-offline` IndexedDB database. It registers the `opsknight-sync` background-sync tag when supported. The network banner also asks the active service worker to flush and the foreground client flushes after reconnection.

Only enqueue a mutation when all of these are true:

- the server endpoint is idempotent enough to retry safely;
- the UI clearly reports that the action is queued, not completed;
- authentication, authorization, validation, conflicts, and stale state are handled;
- the user can verify the resulting server state; and
- the public offline support matrix is updated.

The foreground queue keeps network errors and 401, 408, 429, and 5xx responses for another attempt. It removes other non-success responses. The service worker keeps 408, 429, and 5xx responses but removes other failures. Reconcile these paths if changing retry policy.

## Local app lock

`MobileBiometricToggle` and `MobileBiometricGuard` use browser WebAuthn/platform-authenticator prompts and local preference state to cover the mobile UI after backgrounding. This is a client-side privacy layer. Do not treat it as server authentication, reauthentication for sensitive actions, proof of a particular biometric, or a replacement for session expiry and device controls.

## Styling and interaction

- Mobile theme and status variables live in `src/app/(mobile)/m/mobile.css`, `mobile-premium.css`, and global CSS.
- Use semantic color variables and preserve dark-mode contrast.
- Keep controls keyboard reachable even when the primary design is touch-first.
- Give icon-only controls an accessible name and expose active navigation with `aria-current`.
- Respect `prefers-reduced-motion`; do not make essential state depend only on animation, haptics, gesture direction, or color.
- Test without vibration and without a platform authenticator because both are optional.

## Test and verify

Run targeted tests while iterating:

```bash
npx vitest run tests/components/mobile src/lib/offline-queue.test.ts
```

Before opening a PR, run the repository's normal lint, type-check, unit/integration, and production-build gates as appropriate. For PWA changes, add manual device coverage:

1. fresh browser load without an installed worker;
2. install and standalone launch at `/m`;
3. upgrade from the previous worker;
4. push permission allow and deny;
5. push display and deep link;
6. offline last-known lists;
7. every documented queued action and reconnect result;
8. storage clearing and expired-session behavior; and
9. switch to desktop mode and back.

Record the browser, operating system, installation mode, and result because PWA behavior is platform-dependent.
