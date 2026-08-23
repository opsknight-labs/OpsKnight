---
order: 1
title: Keyboard shortcuts
description: Verified desktop keyboard shortcuts and known v1.3 conflicts
---

# Keyboard shortcuts

OpsKnight includes global and route-specific desktop shortcuts. This reference lists combinations with an implemented handler that does not conflict with another known navigation destination.

Press keys in a sequence one after another, not together. A `g` navigation sequence resets after approximately one second. Shortcuts are normally ignored while you type in an input, text area, or editable field.

## Discover shortcuts in the application

- Select **Keyboard Shortcuts** in the desktop sidebar or user menu.
- Open `/shortcuts` on your OpsKnight host for the in-product reference page.
- Press `?` to open a shortcut overlay. In v1.3, overlapping shortcut providers can cause more than one overlay implementation to respond; use their close button or `Escape` to exit.

The in-product overlays include some label-only or conflicting entries. Use the verified list below for operational workflows.

## Verified global actions

| Keys                    | Result                                    | Notes                                                                      |
| ----------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| `Ctrl+K` or `Command+K` | Focus and open sidebar search             | Requires the desktop sidebar search component                              |
| `?`                     | Open the shortcut overlay                 | On most keyboards this is `Shift+/`                                        |
| `r`                     | Refresh the current Next.js route         | Does not trigger while typing in an editable control                       |
| `c`                     | Open the quick-create menu                | Use the visible create control if no menu is available on the current page |
| `n`                     | Open new incident                         | Implemented only while the current route starts with `/incidents`          |
| `Escape`                | Close the active dialog or search popover | Contextual; not every feature overlay uses the same dialog component       |

Browser-reserved shortcuts take precedence. OpsKnight does not override `Ctrl+R` or `Command+R` as the documented refresh shortcut.

## Verified navigation sequences

| Sequence             | Destination           |
| -------------------- | --------------------- |
| `g`, then `h` or `d` | Dashboard             |
| `g`, then `i`        | Incidents             |
| `g`, then `s`        | Services              |
| `g`, then `t`        | Teams                 |
| `g`, then `u`        | Users                 |
| `g`, then `c`        | Schedules             |
| `g`, then `e`        | Security settings     |
| `g`, then `n`        | Notification settings |

## Do not rely on these combinations in v1.3

The desktop tree contains overlapping shortcut handlers with different destinations for these sequences:

- `g`, then `p` can mean **Policies** or **Profile settings**.
- `g`, then `a` can mean **Analytics** or **API keys**.

Use the sidebar or settings navigation for those destinations. The shortcut legend also displays `Command+S`, `/`, and `g`, then `w`, but the audited global provider does not connect all of those labels to a reliable application action in v1.3.

## Accessibility and safety

- Use visible navigation when a screen reader or browser extension reserves a shortcut.
- Do not depend on a shortcut for an irreversible or time-critical action; confirm the destination and current incident before acting.
- If focus disappears, press `Tab` to restore a visible focus position or reload the page.
- Mobile routes are designed around visible touch controls; these desktop shortcuts are not a supported substitute for mobile navigation.

## Related topics

- [Accessibility support](./README)
- [Incidents](../core-concepts/incidents)
- [Mobile support](../mobile/README)
