---
title: Keyboard shortcuts
description: Verified keyboard commands registered by the current OpsKnight desktop application.
type: reference
product_area: platform
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-10-02
  evidence:
    - src/components/GlobalKeyboardHandler.tsx
    - src/components/KeyboardShortcuts.tsx
    - src/lib/keyboard-shortcuts.ts
    - src/components/incident/IncidentsListTable.tsx
    - src/app/(app)/shortcuts/page.tsx
---

# Keyboard shortcuts

Open `/shortcuts` or press `?` to see the in-product shortcut view. The runtime
handler, popup, and page consume one canonical shortcut registry. Shortcuts are
ignored while focus is in an input, textarea, editable region, and—where the
local handler specifies it—a dialog. A `g` sequence must be completed within one
second.

## Verified global navigation

| Keys | Result |
| --- | --- |
| `g`, then `d` | Dashboard |
| `g`, then `i` | Incidents |
| `g`, then `s` | Services |
| `g`, then `t` | Teams |
| `g`, then `u` | Users |
| `g`, then `c` | Schedules |
| `g`, then `p` | Escalation policies |
| `g`, then `a` | Analytics |
| `Cmd/Ctrl+K` | Open product-wide search |
| `?` | Toggle shortcut help |
| `c` or `Cmd/Ctrl+C` with no selected text | Open Quick Create |
| `n` on an Incidents route | Open Create Incident |

`/` is not a product-wide search shortcut. It focuses local search where a page
implements that behavior, including the Incidents list.

## Incident-list triage

| Keys | Result |
| --- | --- |
| `j` or `↓` | Focus the next visible incident |
| `k` or `↑` | Focus the previous visible incident |
| `x` | Select or deselect the focused incident when manageable |
| `a` | Acknowledge a focused open incident when permitted |
| `r` or `e` | Open resolution for a focused unresolved incident |
| `Enter` or `o` | Open the focused incident |
| `/` | Focus incident search |
| `Esc` | Clear selected/focused incident state |

## Accessibility and safety

Use `Tab`/`Shift+Tab` and visible controls whenever a shortcut conflicts with an
assistive technology or browser command. Shortcut actions still enforce normal
permissions. Before using `a`, `r`, or `e`, verify the focused-row highlight and
incident identity; these commands can mutate incident state.

## Troubleshooting

- Click outside text fields before using a shortcut.
- Complete navigation sequences within one second.
- If a browser or assistive technology captures a key, use the visible control.
- If the shortcut overlay and behavior disagree, report the page, browser,
  focused element, keys pressed, and expected action.
