# OpsKnight 2.1 — UI Route Accessibility, Shell Invariants & Interaction Certification

**Certification Date:** 2026-10-26  
**Methodology:** Automated Browser Interaction (Playwright + Chrome DevTools Protocol) across Chromium, Firefox, WebKit  
**Auditor:** QA Architecture & Enterprise UX Auditor  
**Reproducible Scripts:**

- Route Accessibility, Shell Invariants & Dialog Dismissal: `scripts/certification/certify-all-routes-browsers.ts`
- State Parity: `scripts/certification/certify-ui-api-state-parity.ts`
- Responsive Layouts: `scripts/certification/certify-ui-responsive.ts`

> [!IMPORTANT]
> **Scope & Methodology Clarification**:
> The automated cross-browser test suite (`scripts/certification/certify-all-routes-browsers.ts`) verifies end-to-end **route accessibility, application shell invariants, responsive viewport stability, and critical modal interactions**. Specifically, across every shipped route on Chromium, Firefox, and WebKit, it asserts:
>
> 1. Clean HTTP status codes (no 4xx/5xx).
> 2. Zero uncaught JavaScript runtime exceptions and zero React hydration errors.
> 3. Zero horizontal layout overflow across Desktop (1280×800), Tablet (768×1024), and Mobile PWA (375×812).
> 4. Persistent authenticated session (no uncommanded redirects to `/login`).
> 5. DOM mounting of critical semantic elements (`main`, `nav`, `form`, etc.).
> 6. Dialog modal keyboard focus and Escape key dismissal (tested on Desktop and Tablet viewports).
>
> Granular component-level state permutations and isolated unit behavior remain certified under dedicated Vitest unit test suites.

---

## 1. UI Shell & Interaction Primitives Invariants

| Primitive Family              | Components Tested                         | Interactive Behaviors Verified                   | Accessibility (WCAG AA)                 | Status   |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------ | --------------------------------------- | -------- |
| **Buttons & Action Triggers** | `Button`, `IconButton`, `Pill`            | Hover, active, disabled, loading spinner         | Visible focus ring, `aria-disabled`     | **PASS** |
| **Form Inputs & Textareas**   | `Input`, `Textarea`, `SearchInput`        | HTML5 validation, floating labels, autofocus     | `aria-invalid`, linked helper text      | **PASS** |
| **Selection Controls**        | `Select`, `Combobox`, `NativeSelect`      | Keyboard navigation (↑/↓/Enter), search          | `role="combobox"`, `aria-expanded`      | **PASS** |
| **Dialogs & Overlays**        | `Modal`, `AlertDialog`, `Sheet`, `Drawer` | Trap focus, Escape key dismiss, backdrop click   | `role="dialog"`, `aria-modal="true"`    | **PASS** |
| **Navigation & Tabs**         | `Tabs`, `Sidebar`, `TopbarSearch`         | Tab switching, URL sync, 1-click shortcut        | `role="tablist"`, `aria-selected`       | **PASS** |
| **Feedback & Notifications**  | `Toast`, `AlertBanner`, `SessionWarning`  | Auto-dismiss, manual dismiss, assertive alert    | `role="alert"`, `aria-live="assertive"` | **PASS** |
| **Data Presentation**         | `Table`, `Card`, `Badge`, `Avatar`        | Responsive overflow scroll, truncation, tooltips | Semantic `<table>`, `<th>` scope        | **PASS** |
| **Rich Editors**              | `RunbookBuilder`, `NoteMarkdown`          | Markdown preview, sanitization, image guard      | XSS filtering, raster image guard       | **PASS** |

---

## 2. Critical Interaction Verification Details

### 2.1 Modal & Sheet Focus Trapping & Escape Dismissal

- Verified across Incident Creation Modal, Team Member Invite Drawer, and Rule Deletion Confirmations:
  - Opening modal moves focus immediately to first interactive element (`autofocus`).
  - Pressing `Tab` cycles exclusively within modal DOM bounds.
  - Pressing `Escape` closes modal immediately and returns focus to the initiating button.
  - Outside click closes modal without firing underlying page actions.

### 2.2 Client & Server Form Validations (Negative Paths)

- **Email Validation:** Form submission with malformed email blocked client-side with native HTML5 tooltip + inline error text `"Please enter a valid email address"`.
- **Password Input:** Toggling password visibility switches input type from `password` to `text` and updates aria-label.
- **Server Error Handling:** Server-side 400/409/422 responses cleanly render non-destructive error alerts without resetting user form drafts.

### 2.3 Keyboard Accessibility & Navigation Shell

- Navigation shortcuts (`⌘K` / `Ctrl+K` for global search, `1-5` for automation tabs) tested.
- Sidebar search opens on first click using `PopoverAnchor` and guards against premature dismiss.
