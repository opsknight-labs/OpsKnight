---
title: Accessibility support and validation
description: Current accessibility behavior, known boundaries, and an acceptance workflow for critical incident response.
type: reference
product_area: platform
audience: [responder, administrator, operator]
verification:
  level: source
  verified_at: 2026-10-02
  evidence:
    - src/components/SkipLink.tsx
    - src/components/KeyboardShortcuts.tsx
    - src/components/TopbarNotifications.tsx
    - src/app/globals.css
    - scripts/docs/crawl-rendered-site.mjs
---

# Accessibility support and validation

OpsKnight implements keyboard-accessible navigation patterns, a skip-to-main
link, visible focus treatment, semantic labels on many icon controls, dialog
focus management, screen-reader-only text, and reduced-motion styles. These are
implemented behaviors, not a claim that every workflow is conformant with every
browser, device, or assistive-technology combination.

## Interaction support

- Use the skip link to move directly to the main content region.
- Use `Tab` and `Shift+Tab` to reach controls; dialogs and sheets should expose a
  named surface and a close path.
- Interactive notification rows support keyboard activation when they have a
  target. Icon-only controls include accessible names in reviewed surfaces.
- Keyboard shortcuts supplement visible controls and are disabled in common text
  entry contexts. See [Keyboard shortcuts](./keyboard-shortcuts).
- Reduced-motion preferences disable or reduce selected animations through CSS;
  do not assume every third-party or browser animation is removed.
- Status should be communicated by text/icon/state as well as color in critical
  reviewed workflows. Verify this in any customized theme.

## Zoom, reflow, and mobile

Navigation and sheets use responsive layouts, and mobile routes provide focused
operational workflows. Browser zoom, OS text scaling, long translated labels,
virtual keyboards, and narrow devices can still expose local reflow issues.
Test the exact pages responders will use rather than treating one responsive
page as evidence for the whole product.

## Organization acceptance test

Before production rollout and after a significant UI/theme upgrade:

1. Choose the supported browser, operating system, screen reader, magnification,
   voice-control, or switch-control combinations used by your responders.
2. Sign in, use the skip link and main navigation, search for an incident, and
   open the notification inbox without a pointer.
3. Create or open a controlled incident; acknowledge, assign, add a note,
   escalate, and resolve it using visible focus and announced labels.
4. Open and close every modal in the critical path. Confirm focus enters the
   surface, remains usable, and returns to a sensible trigger.
5. Test 200% and 400% zoom/reflow where required by your policy. Confirm that
   critical actions are not clipped or hidden behind fixed regions.
6. Enable reduced motion and high-contrast/color adjustments used by your team.
7. Repeat the response path on the supported mobile/PWA setup.
8. Record browser/AT versions, results, exceptions, owner, and retest date.

## Known boundaries

Accessibility can vary across complex tables/charts, live-updating regions,
drag/reorder interactions, custom dashboards, external ChatOps clients, public
status-page themes, and browser/assistive-technology combinations. Charts need a
textual or tabular interpretation for decisions. Live updates may require a
manual refresh if an announcement is missed. Use the visible non-drag controls
or documented alternative workflow when available.

## Report an accessibility issue

Capture the route, task, browser and operating-system versions, assistive
technology and version, zoom/text settings, focused element, expected result,
actual result, and whether a visible alternative worked. Avoid including
sensitive incident content in a report. Treat inability to acknowledge or
resolve a production incident as an operational-access blocker and use the
approved alternate response channel while it is investigated.

## Related pages

- [Navigation, search, and inbox](../guides/navigation/search-and-notifications)
- [Keyboard shortcuts](./keyboard-shortcuts)
- [Mobile and PWA](../guides/mobile/README)
- [Respond to incidents](../guides/incidents/README)

