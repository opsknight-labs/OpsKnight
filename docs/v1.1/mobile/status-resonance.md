---
order: 1
---

# Mobile Status Resonance (UI)

This note captures the mobile header/status updates and the status-tinted ambient background.
We will mirror the same idea on desktop later.

## Scope

- Mobile header status pill uses a revolving/resonating badge.
- Page background tint shifts based on system status (ok/warning/danger).
- Background uses a slow ambient animation to make the tint feel alive.

## Files Touched

- `src/components/mobile/MobileHeader.tsx`
- `src/app/(mobile)/m/layout.tsx`
- `src/app/(mobile)/m/mobile.css`

## Behavior

- Status colors:
  - `ok`: green tint.
  - `warning`: yellow tint.
  - `danger`: red tint.
- The mobile shell gets `data-status` to drive CSS variables.
- The `mobile-content` background uses status-tinted radial gradients and a resonance animation.
- The status capsule includes orbiting rings and a pulsing stroke (resonating effect).

## Follow-up (Desktop)

Apply the same system on desktop:

1. Add `data-status` to the desktop shell/container.
2. Add status-tinted background gradients in the desktop layout CSS.
3. Reuse the status pill animation or build a desktop variant.
