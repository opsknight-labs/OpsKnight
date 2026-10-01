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
    - src/components/KeyboardShortcutsProvider.tsx
    - src/components/incident/IncidentsListTable.tsx
    - src/app/(app)/shortcuts/page.tsx
---

# Keyboard shortcuts

Open `/shortcuts` or press `?` to see the in-product shortcut view. Shortcuts are
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
| `?` | Toggle shortcut help |
| `c` or `Cmd/Ctrl+C` with no selected text | Open Quick Create |
| `n` on an Incidents route | Open Create Incident |

The keyboard provider also registers `g h` for Dashboard, `g p` for Profile,
`g e` for Security, `g a` for API Keys, `g n` for Notifications, `/` for an
element marked as the current search input, and `r` for a route refresh. Context
determines which handler receives overlapping sequences; use the visible
`/shortcuts` page as the product-facing list and verify critical shortcuts in
your deployed build.

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

## Known display boundary

The exported `KEYBOARD_SHORTCUTS` list currently advertises `Cmd+K`, `Cmd+S`,
`Esc`, and `g w`, but the keyboard provider itself does not register handlers
for all of those entries. Some may be supplied by a focused component or native
dialog behavior. Do not build an operating procedure around an advertised entry
until it works in the target page and browser. This page deliberately documents
registered handlers and calls out the mismatch rather than claiming unsupported
global behavior.

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

