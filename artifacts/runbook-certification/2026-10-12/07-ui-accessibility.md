# OpsKnight Runbooks Certification — 07. UI, Authoring & Accessibility Standards

**Audit Date:** 2026-10-12  
**Commit:** `ea38c8c5601189225e3c5edd1efeed855c034c7d`  

---

## 1. Visual Builder vs. Advanced JSON Authoring

The runbook authoring experience in `src/components/runbooks/RunbookBuilder.tsx` provides dual-mode authoring:

### 1.1 Dual Authoring Modes
1. **Visual Step Builder:**
   - Drag-and-drop step reordering and dependency wiring.
   - Type-specific configuration forms for all 10 step types.
   - Reactive validation for required parameters (e.g. Kubernetes resource names, systemd unit names, HTTP endpoints).
2. **Advanced JSON Editor:**
   - Raw JSON editing with schema linting and syntax highlighting.
   - Synchronized bidirectional state: visual edits reflect in the JSON buffer; validated JSON changes compile into the visual builder graph without losing uncommitted selections.

### 1.2 Input Variable Management & Validation
- **Syntax Validation:** Strict validation ensures variable references follow `{{input.variable_name}}` without syntax errors.
- **Dependency Tracking:** Deleting an input referenced by downstream steps produces an immediate inline error badge pointing to the affected step.
- **Regex Safety:** Input search and token resolution rely on static AST tokenizers rather than dynamic regular expressions, preventing browser freezes during authoring.

---

## 2. Accessibility & Keyboard Navigation (a11y)

### 2.1 Control Hygiene & Clean DOM Semantics
- **Elimination of Nested Interactive Elements:**
  - In earlier iterations, step move/delete buttons were nested inside the step card selector button, violating WCAG 2.1 specifications and causing Playwright click ambiguities.
  - PR #859 separated the card selection handle from the action menu, creating discrete, accessible `<button>` targets with distinct `aria-label` attributes.
- **Focus Management:**
  - Selecting a step in the sidebar moves focus smoothly to the active editor pane.
  - Opening confirmation dialogs (e.g. deleting steps, publishing draft) traps focus within the modal and restores focus to the triggering element upon closure.

### 2.2 Visual Indicators & High Contrast
- Status indicators (`READY`, `RUNNING`, `WAITING_APPROVAL`, `SUCCEEDED`, `FAILED`) use both distinct color palettes and explicit text labels/icons, ensuring full usability for colorblind operators.
- Step risk classifications (`READ_ONLY`, `IDEMPOTENT_WRITE`, `NON_IDEMPOTENT`) feature prominent shield icons and clear warning callouts.

---

## 3. Responsive Design & Mobile Operator Support

- **Compact Header Chrome:** On mobile viewports (< 768px), navigation chrome collapses into a clean top drawer, preserving vertical screen estate for reviewing runbook steps.
- **Touch-Friendly Hit Targets:** Action buttons and step navigation pills maintain minimum 44x44px touch targets.
- **Mobile Execution Preview:** The execution preview modal adapts to single-column stacking, allowing incident commanders to review plan digests and approve steps directly from mobile devices.

---

## 4. Playwright Browser Matrix Configuration

The repository defines an end-to-end browser test suite in `playwright.runbooks.config.ts`:
- **Target Engines:** Chromium, Firefox, and WebKit (Safari).
- **Safety Fence:** Explicit check ensures tests only run against an isolated test database:
  ```typescript
  if (!databaseUrl || new URL(databaseUrl).pathname !== '/runbook_ui_test') {
    throw new Error('Runbook browser tests require a dedicated runbook_ui_test database.');
  }
  ```
- **Session Signing:** Uses independent session signing secrets and mock authentication providers to prevent session leakage.
