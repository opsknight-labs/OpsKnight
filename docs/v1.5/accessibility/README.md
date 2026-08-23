---
order: 10
title: Accessibility
description: Keyboard, focus, screen-reader, motion, mobile, testing, and known accessibility boundaries in OpsKnight v1.4
---

# Accessibility

OpsKnight v1.4 includes keyboard, focus, semantic, status-announcement, and reduced-motion behaviors across many core interfaces. Accessibility is an ongoing engineering requirement, not a certification claim: v1.4 has not been documented as independently audited for WCAG conformance, and behavior varies by page, browser, assistive technology, and custom deployment styling.

Use this guide to understand the implemented support and the boundaries you should test before declaring a deployment suitable for a particular responder population.

## Keyboard and focus

Desktop application pages provide a visible-on-focus **Skip to main content** link whose target is the main page container. Native links, buttons, inputs, selects, and text areas retain keyboard behavior and receive a global `:focus-visible` outline.

Many application dialogs expose dialog semantics, a title, modal state, Escape handling, and a focus trap through the shared dialog components. Some older or feature-specific overlays implement these behaviors independently, so test the exact workflow rather than assuming every overlay is equivalent.

Read [Keyboard shortcuts](./shortcuts) for verified shortcuts and known conflicts. Shortcuts ignore most keystrokes while focus is in an input, text area, or editable region. This prevents common typing conflicts but does not replace testing for browser and assistive-technology key collisions.

### Known v1.4 keyboard boundaries

- The rendered **Skip to navigation** link points to `#navigation`, while the desktop sidebar currently uses `#app-sidebar`. Do not rely on that skip target in v1.4; use normal Tab or Shift+Tab navigation.
- Dashboard widget drag/reorder affordances expose semantic hints, but a complete keyboard reordering workflow is not documented. Use non-drag configuration controls where available.
- Some shortcut labels and handlers come from two overlapping implementations. The support reference excludes conflicting or label-only combinations.
- Touch gestures and haptics are enhancements. Every critical response workflow should be verified with its visible control.

## Screen-reader behavior

Implemented patterns include:

- named desktop and mobile navigation regions;
- `aria-current="page"` on active navigation links;
- labels for many icon-only controls and destructive actions;
- `aria-expanded`, `aria-controls`, and region relationships on collapsible widgets;
- dialog, alert-dialog, alert, status, list, and list-item roles in shared components and selected views;
- polite live regions for toasts, save status, and selected metric or form feedback;
- `aria-invalid` and described-by relationships in shared form controls; and
- text labels alongside status colors in incident, service, notification, and status views.

Coverage is not asserted for every page or every third-party component. In particular, charts, complex tables, drag-and-drop controls, visual timelines, and dynamically updated status views require task-level testing with the screen readers your organization supports.

Decorative icons should be hidden from the accessibility tree. New icon-only controls must have an accessible name that describes the action, not the icon shape.

## Motion, color, and touch

Selected global, navigation, login, dashboard, mobile, and notification animations respond to `prefers-reduced-motion: reduce`. This is not a blanket removal of every transition. Verify each animated workflow with the operating-system reduced-motion preference enabled.

OpsKnight uses visible text, badges, and icons in addition to color for many states. Do not introduce an incident, urgency, provider, or validation state that can be understood only from red/green color or motion.

Mobile styles provide touch-oriented controls and coarse-pointer adjustments, including 44-pixel targets in selected flows and 16-pixel form text to avoid iOS zoom. This is not a guarantee that every legacy or embedded control meets the same target size.

## Forms and errors

Shared form primitives connect labels, descriptions, error text, invalid state, and controls. Authentication and selected settings forms use alert or live-region semantics for asynchronous errors. When adding a form:

1. Give every input a persistent programmatic label.
2. Associate help and error text with the control.
3. Move focus to, or clearly announce, a blocking submission error.
4. Preserve entered data after a recoverable failure.
5. Do not make placeholder text the only label.
6. Test keyboard-only submission and error recovery.

## Mobile accessibility

The mobile shell names its navigation, exposes the active item, adds accessible labels to the notification count, and hides underlying content from the accessibility tree while the local app-lock overlay is active. The mobile status indicator includes a visible text label so its color and ambient animation are supplementary.

Swipe navigation, pull to refresh, vibration, biometric prompts, and installed-PWA behavior depend on device capabilities. The visible navigation and action buttons are the supported alternative. Test portrait zoom, large text, external keyboard, reduced motion, screen reader, permission denial, and loss of connectivity on representative devices.

The client-side app lock is a privacy overlay, not an authentication boundary. Its platform prompt and announcement behavior differ by browser; never use it as the only protection for sensitive information.

## Deployment acceptance test

Before rollout, choose the responder tasks that must work in your environment and test at least:

1. sign in and sign out;
2. navigate to incidents without a pointer;
3. open, acknowledge, note, reassign, and resolve an incident;
4. identify status and urgency without color;
5. read a notification and follow its incident link;
6. inspect a schedule and identify the current on-call user;
7. recover from validation, authorization, and network errors;
8. complete the task at 200% browser zoom and with large text;
9. repeat with reduced motion; and
10. repeat critical tasks with your supported screen reader/browser combinations.

Record application version, browser, operating system, assistive technology and version, route, task, result, and any workaround. Re-run this suite after upgrades or major theme/customization changes.

## Report an accessibility problem

Include enough detail to reproduce the issue without including incident secrets or personal data:

- OpsKnight version and deployment type;
- exact route and task;
- browser and operating-system versions;
- assistive technology and version;
- expected and observed behavior;
- keyboard sequence or gesture;
- whether zoom, large text, high contrast, or reduced motion was enabled; and
- a sanitized screenshot or short recording when safe.

For a blocking incident-response barrier, provide responders with an alternate response channel while the issue is investigated.

## Contributor checks

Component and utility tests cover selected labels, roles, skip links, keyboard helpers, dialogs, and mobile controls. Passing those tests is not a full accessibility audit. For user-interface changes:

- prefer native HTML before adding ARIA;
- run lint, unit, and interaction tests;
- inspect the accessibility tree;
- test keyboard focus order and visible focus;
- test zoom, reflow, contrast, and reduced motion; and
- perform manual screen-reader task testing for critical flows.

## Related topics

- [Keyboard shortcuts](./shortcuts)
- [Mobile support](../mobile/README)
- [Troubleshooting](../troubleshooting)
