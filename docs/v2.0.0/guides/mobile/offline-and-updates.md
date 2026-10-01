---
title: Understand mobile offline state and updates
description: Distinguish cached, queued, failed, and confirmed mobile state and recover safely after reconnecting.
type: how-to
product_area: mobile
audience: [responder, administrator]
reader: { status: READER_COMPLETE, task: Recover mobile state after an offline period or PWA update. }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/components/mobile/MobilePwaCoordinator.tsx", "src/components/mobile/MobileNetworkBanner.tsx", "src/lib/offline-queue.ts", "src/app/(mobile)/m/incidents/create/client.tsx"]
---

# Understand mobile offline state and updates

## Before you begin

Treat the server as authoritative. Cached data and locally stored drafts support continuity, but they do not prove a responder action reached OpsKnight.

## Open the feature

The mobile shell displays network and queue banners. Open a banner to inspect pending/failed actions when controls are available.

## Configure safe offline use

1. When **You're offline. View-only mode** appears, use cached pages only for context.
2. Do not tell other responders an action succeeded unless it becomes confirmed after reconnect.
3. Incident creation drafts are encrypted and saved on-device, but creation is not queued while offline.
4. After reconnecting, let Background Sync/page replay run and inspect the queue summary.
5. Treat `queued` as not yet accepted, `failed` as requiring attention, and `confirmed` as server-accepted.
6. Refresh the affected incident before repeating an action to avoid a conflict with newer server state.

## What OpsKnight does

The page coordinator and service worker coordinate queue restoration/flush. Authentication failure pauses unsafe replay and can redirect to mobile login. Cached-data notices identify stale content; online events trigger recovery but do not make every queued mutation valid.

## Verify recovery

Require zero pending/failed actions, reload key incidents, and compare their timeline/status with the intended outcome. For a PWA update, close all app windows, reopen, and confirm the new service worker controls the page.

## Remove or reset

Sign out before clearing site data when possible. Clearing browser storage removes cached data, encrypted drafts, and local queue state; record unresolved actions first. Reinstall only after confirming there is no unsubmitted work.

## Troubleshooting

- **Queue stays pending:** keep one app window online and authenticated, then refresh once.
- **Queue failed:** inspect the action; authorization or lifecycle state may have changed.
- **Old UI after release:** close all windows and reopen; if needed remove/reinstall after preserving drafts.
- **Draft missing:** site-data cleanup, browser eviction, or a different profile/device may have removed local storage.

## Next steps

- [Install and enable push](./install-and-notifications)
- [Respond on mobile](./respond-to-incidents)
