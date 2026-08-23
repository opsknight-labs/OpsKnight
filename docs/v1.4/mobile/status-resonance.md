---
order: 3
title: Mobile status resonance
description: Contributor note for mobile system-status colors, animation, and accessibility boundaries
---

# Mobile Status Resonance (UI)

This contributor note describes the mobile header status indicator and status-tinted ambient background. It is a visual summary; responders must use incident and service data for the operational detail behind the color.

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

Color and animation are supplementary. Preserve the visible text label, do not encode status only by color, and disable nonessential motion when `prefers-reduced-motion: reduce` is active.

## Desktop parity checklist

Apply the same system on desktop:

1. Add `data-status` to the desktop shell/container.
2. Add status-tinted background gradients in the desktop layout CSS.
3. Reuse the status pill animation or build a desktop variant.
