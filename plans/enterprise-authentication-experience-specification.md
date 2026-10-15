# OpsKnight Enterprise SSO — World-class UI/UX overhaul plan

Based on merged [PR #865](https://github.com/opsknight-labs/OpsKnight/pull/865), `main` commit `4be1e13`, the existing authentication UI, backend queries, and browser tests.

## 1. Audit verdict

Current UX maturity

# 5.5/10

Source-based assessment

Target

# 9.5+/10

After implementation and testing

The backend is significantly more mature than the administration experience. The UI exposes technical implementation details, separates dependent actions across tabs, and relies heavily on plain forms, cards, and lists instead of helping an administrator complete a workflow.

That creates an important distinction: a feature can be technically correct but still be difficult to configure safely.

I inspected the actual React components and API queries, rather than assuming every reported problem is cosmetic. These are the main findings:

| Priority | Finding                                                            | Evidence and impact                                                                                                                                 |
| -------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Configuration changes cannot be saved naturally from every section | Provisioning, role mapping and session policy update a shared draft, while staging lives in Connection                                              |
| P1       | Disabled buttons don't explain prerequisites                       | Several actions require a revision ID, clean draft, successful administrator test or explicit confirmation, without a nearby actionable explanation |
| P1       | Provider changes retain potentially irrelevant configuration       | Switching from Auth0 to Entra changes provider and issuer but doesn't clear the previous Auth0 organization ID                                      |
| P1       | Session filtering operates only on the last 100 fetched sessions   | Filtering for OIDC can miss matching sessions outside that initial set                                                                              |
| P2       | Diagnostics has incomplete pagination                              | Deliveries use accumulating Load More; sessions, security events and replica observations have fixed limits without full navigation                 |
| P2       | Diagnostic refresh can unexpectedly reset delivery history         | Its loading effect depends on the entire dashboard `data` object                                                                                    |
| P2       | Session presets were removed                                       | Administrators now enter raw seconds instead of choosing meaningful durations                                                                       |
| P2       | Provider-specific forms are cluttered                              | The Auth0 organization field appears even for Microsoft Entra, Google and Okta                                                                      |
| P2       | Recovery-account management is overloaded                          | Enrollment, credential rotation, disabling and compromise declarations share one long form and list                                                 |
| P2       | Error messages are too generic or distant                          | Server failures are displayed at the console level; field errors and next actions aren't consistently identified                                    |
| P3       | Visual hierarchy is weak                                           | The interface repeats bordered sections and similarly styled controls, with insufficient distinction between setup, status and dangerous operations |

These findings come primarily from [AuthenticationConsole.tsx](https://github.com/opsknight-labs/OpsKnight/blob/4be1e13bd51e361b52ad97b77dcbcb4343ba4ae8/src/components/settings/AuthenticationConsole.tsx), [AuthenticationDiagnostics.tsx](https://github.com/opsknight-labs/OpsKnight/blob/4be1e13bd51e361b52ad97b77dcbcb4343ba4ae8/src/components/settings/AuthenticationDiagnostics.tsx) and [dashboard.ts](https://github.com/opsknight-labs/OpsKnight/blob/4be1e13bd51e361b52ad97b77dcbcb4343ba4ae8/src/lib/auth-control/dashboard.ts).

This is a source-level UX and logic audit, not an independent visual walkthrough of your live deployment.

The objective should be to make the correct operation obvious and safe, rather than simply make the screen look attractive.

## 2. Redesign the information architecture

The current interface makes administrators understand OpsKnight's internal revision system before they can perform routine tasks.

I would redesign it around six clearly defined areas:

| Area                  | Purpose                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Overview              | Understand current authentication health and what requires attention                      |
| Identity Provider     | Configure Microsoft, Google, Okta, Auth0 or custom OIDC                                   |
| Access & Provisioning | Manage JIT, allowed domains, role mapping, user linking and SCIM                          |
| Sessions & Policies   | Configure session duration, idle timeout, authentication modes and active sessions        |
| Emergency Recovery    | Manage recovery accounts, credentials, readiness and drills                               |
| Diagnostics           | Troubleshoot authentication, security email delivery, audit history and deployment health |

Crucially, first-time setup and ongoing administration should be different experiences.

### First-time setup: guided workflow

Configure Enterprise SSO

Example design

1. Choose identity provider
2. Configure credentials and callback URLs
3. Validate discovery and test administrator login
4. Configure access policies and emergency recovery
5. Review impact and activate

Changes remain inactive until activation

Every step should show its actual state: Not started, Needs attention, Ready to test, Verified, or Active.

Once SSO is configured, administrators should land on a normal management dashboard—not be forced through the wizard again.

### Ongoing administration: operational dashboard

The Overview page should immediately communicate:

- Which provider is active, its issuer and authentication mode.
- Whether the last real administrator SSO test succeeded and when.
- Current effective session policies.
- Number of independently verified emergency identities.
- Any degraded recovery, provider-configuration conflicts or failed security notifications.
- The single most relevant next action.

For example, if SSO is configured and working, the primary action might be Manage provider. If configuration is incomplete, it should be Continue setup.

Avoid showing six identical action buttons on the initial screen.

## 3. Rebuild provider configuration intelligently

Your Microsoft/Auth0 observation is a real issue.

Currently, the Auth0 Organization ID field is rendered unconditionally. More importantly, switching provider types changes the provider and issuer fields but does not reset unrelated provider-specific settings. That can carry an old Auth0 organization parameter into a subsequent OIDC test.

[Relevant code](https://github.com/opsknight-labs/OpsKnight/blob/4be1e13bd51e361b52ad97b77dcbcb4343ba4ae8/src/components/settings/AuthenticationConsole.tsx#L404-L477)

### Required provider-specific behavior

| Provider               | Main visible configuration                                      | Advanced configuration                     |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| Microsoft Entra ID     | Tenant ID, Client ID, Client Secret                             | Claims, token-endpoint authentication      |
| Google Workspace       | Client ID, Client Secret, optional Workspace domain restriction | Custom scopes, role mapping                |
| Okta                   | Okta issuer/domain, Client ID, Client Secret                    | Authorization server and scopes            |
| Auth0                  | Tenant issuer, Client ID, Client Secret                         | Optional Organization ID and scopes        |
| Custom OIDC / Keycloak | Exact issuer URL, Client ID, Client Secret                      | Endpoint authentication, scopes and claims |

Implementation rules:

1. Drive field visibility and validation from a provider-definition registry, not scattered conditional checks.
2. Never serialize an irrelevant provider-specific field into a new staged configuration.
3. Preserve the existing active configuration while editing a new provider draft.
4. On provider switching, require deliberate confirmation before discarding incompatible draft values.
5. Treat an unknown historical provider configuration as a compatibility case rather than silently changing it.
6. Keep issuer-based security validation authoritative on the backend.

For Microsoft Entra, an administrator should enter a Tenant ID and see the issuer generated automatically. There is no reason to make them manually compose a URL containing `{tenantId}` unless they explicitly choose advanced editing.

Callback URLs should each have Copy buttons, registration instructions, and a simple explanation of why there are production and test callbacks.

Keep fields such as `client_secret_basic`, `client_secret_post`, additional scopes and profile claims under Advanced settings with readable explanations.

## 4. Restore the good session-policy experience

The old `SsoSettingsForm.tsx` already contains human-readable duration presets and custom-unit handling. Reuse that interaction concept rather than reinventing it.

## Session policies

Proposed interaction preview

Maximum session lifetime

Require a new OpsKnight authentication when this limit is reached.

1 hour8 hours12 hours24 hours7 daysCustom

Idle timeout

End the session after this period without activity.

15 min30 min1 hour2 hours4 hours8 hoursCustom

Interactive concept only; changes here do not modify OpsKnight.

In the actual implementation, restore an Inherited default choice, presets and custom values with minutes/hours/days. Show the effective value returned by the backend, not an assumed default.

Validate the relationship between idle timeout and maximum lifetime immediately. When an incompatible value is selected, explain the conflict and offer an adjustment.

Also distinguish OpsKnight session lifetime from Microsoft Entra Conditional Access sign-in frequency. They are different controls; the UI should not imply it configures Microsoft's tenant session policy.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://learn.microsoft.com\&sz=32)

Microsoft Learn



## 5. Make every unavailable action understandable

This needs to become a reusable UX rule across the entire application, starting with SSO.

### Proposed action behavior

| Action                    | What the user should see when it cannot proceed                                              |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Stage configuration       | Inline errors identifying missing or invalid fields                                          |
| Test administrator login  | “Stage your latest changes before testing” with a direct action                              |
| Preview activation impact | “Select or stage a provider revision”                                                        |
| Activate SSO              | A list of unmet conditions and where to resolve each                                         |
| Create emergency identity | “Enter a name and confirm independent credential custody”                                    |
| Rotate recovery password  | “Verify a replacement recovery identity first”                                               |
| Revoke session            | “This session is already expired or revoked” rather than an unexplained inactive button      |
| Retry security email      | Only offer the action for eligible failed delivery records, with an appropriate confirmation |

### Build a centralized action-eligibility system

Instead of scattering long `disabled={...}` expressions throughout `AuthenticationConsole.tsx`, introduce a normalized action state.

Example structure:

```
type ActionAvailability = {
  action: string;
  allowed: boolean;
  blockers: Array<{
    code: string;
    message: string;
    resolutionLabel?: string;
    resolutionTarget?: string;
  }>;
};
```

The backend should provide authoritative blockers for security-sensitive operations, while the frontend adds immediate field validation.

For example, activating SSO might display:

Activate SSO Required

Provider discovery validated

Administrator login verified

One more emergency identity needs verification

1 requirement remaining

How to complete

A tooltip alone is insufficient for essential instructions. Use persistent helper text and inline errors; reserve tooltips for supplementary explanations. This follows established Carbon form guidance.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.carbondesignsystem.com\&sz=32)

Carbon Design System



Never change server-side permission checks merely to make the button clickable. Security-sensitive actions must revalidate prerequisites and fresh authentication at execution time.

## 6. Completely rebuild Diagnostics

This is the area where I would make the most substantial architectural and UX improvements.

The current Diagnostics component is only 280 lines and combines sessions, email delivery, replica state and emergency audit events into one long page.

It doesn't have the information structure an operator needs when diagnosing a real authentication incident.

### Proposed Diagnostics structure

## Authentication Diagnostics

Example of the proposed hierarchy

Active sessions

Review and revoke

Failed security emails

Investigate delivery

Recovery activity

Audit authentication

Deployment health

Replica consistency

Diagnostic views

&#x20;Sign-in & session activity

&#x20;Security notification delivery

&#x20;Recovery & audit events

&#x20;Replica & configuration health

The top-level summary should show current operational status, while historical investigation lives within focused views. Don't mix global lifetime totals with currently actionable failures.

### 6.1 Sessions: real filtering and pagination

The existing backend fetches the most recent 100 registered sessions before the frontend filters them. This must change.

Replace it with a server-driven session query that supports:

| Capability            | Proposed behavior                                                          |
| --------------------- | -------------------------------------------------------------------------- |
| Search                | User name, email or permitted session identifier                           |
| Authentication method | All, Password, OIDC                                                        |
| State                 | Active, Expired, Revoked                                                   |
| Time range            | Last 24 hours, 7 days, 30 days, Custom                                     |
| Sort                  | Last activity, created time, expiration                                    |
| Page size             | 25, 50, 100                                                                |
| Pagination            | Previous/Next using stable keyset cursors                                  |
| Action                | Revoke eligible session with confirmation                                  |
| Details               | Issued at, last activity, expiry, method, policy version, revocation state |

The filter must execute in PostgreSQL before pagination. A user should never get an empty OIDC result merely because the first 100 sessions happen to be password sessions.

Keep sensitive session tokens off the client. Query only the columns needed for the selected view.

### 6.2 Security email delivery: proper operational table

The existing delivery history already has useful keyset pagination with a 25-row limit. Preserve that backend principle, but replace the accumulating list.

The new table should have:

| Event                        | Status    | Attempts | Last activity | Action          |
| ---------------------------- | --------- | -------- | ------------- | --------------- |
| Admin access changed         | Delivered | 1        | Relative time | View            |
| SSO policy alert             | Failed    | 3        | Relative time | Inspect / Retry |
| Recovery credential enrolled | Pending   | 0        | Relative time | View            |

These are illustrative rows, not actual instance data.

Each row should open a detail panel containing a safe, redacted timeline:

Queued → Provider accepted → Delivered / Failed / Cancelled

Where supported by stored evidence, include the provider, retry attempts, last known error, related event and timestamps. Do not invent delivery stages that the database cannot prove.

Retry remains a deliberate action with the existing duplicate-delivery warning and generation/version checks.

After a successful retry, update the affected row and its status instead of resetting every diagnostic view.

### 6.3 Audit and emergency activity

The current dashboard returns only 50 recent emergency events, with no real historical navigation.

Build a paginated audit view with:

- Timestamp and event type.
- Actor category and permitted identity details.
- Affected recovery identity or configuration.
- Success, failure, denial or revocation outcome.
- Safe explanation of why the action occurred or failed.
- Correlation identifier where available.
- Filters by event type, outcome, actor and time.

Use `EmergencyAccessEvent` and existing authentication audit evidence, keeping source provenance explicit. If a particular sign-in event is not reliably persisted, do not present it as an audited event until instrumentation exists.

### 6.4 Deployment and replica health

Replica diagnostics should answer operational questions, not display raw technical IDs.

For each observed replica, show the last report, consistency state and any known mismatch. Separate currently active observations from historical records.

Provide a guided resolution for conflicting canonical URLs or authentication settings, including which deployment settings require an operator restart.

Do not offer unsafe automatic changes to infrastructure configuration.

## 7. Pagination architecture — shared, reusable and scalable

This should be developed as a reusable table and query pattern rather than implemented differently in each subsection.

### Backend contract

A suitable server-side response would look like:

```
type PaginatedResult<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  pageSize: 25 | 50 | 100;
  snapshotAt: string;
};
```

Use stable keyset ordering, such as `(createdAt DESC, id DESC)`, with composite indexes appropriate to each filter.

Cursors should be opaque, bound to their filter/sort context and protected against tampering where necessary. On the client, maintain a small stack of previous cursors rather than appending an unbounded list.

### UI behavior

Security events

Illustrative

25 / page

Records 1–25 of many

Table rows load from a paginated API in the actual implementation.

Page 1

&#x20;PreviousNext&#x20;

Visual interaction preview; page numbers are illustrative, not connected to repository data.

Use compact pagination on mobile and top/bottom controls when tables are long. These choices align with current PatternFly enterprise-table guidance.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://staging.patternfly.org\&sz=32)

Pagination



For very large datasets, display “1–25 of many” instead of performing expensive exact counts solely to populate the UI.

### Specific code corrections

- Fix `AuthenticationDiagnostics.tsx` so changes to unrelated dashboard data do not reset delivery filters and pagination.
- Add server-side search/filter/cursor support for registered sessions.
- Add dedicated pagination for `EmergencyAccessEvent`.
- Use clear loading, error, no-data and no-results states.
- Make page size and date filters persist while navigating between diagnostic views.
- Benchmark pagination against large tables and inspect indexes with PostgreSQL `EXPLAIN ANALYZE`.

## 8. Emergency Recovery UI overhaul

The current screen places too many operations directly into each account card.

Use a compact, readable Recovery Accounts table or structured list with each identity showing:

| Field           | Purpose                                              |
| --------------- | ---------------------------------------------------- |
| Identity name   | Recognize the responsible custodian                  |
| Recovery method | Password / Hardware key                              |
| Readiness       | Verified / Drill required / Disabled                 |
| Last verified   | Understand whether recovery has been tested recently |
| Last used       | Help identify recovery activity                      |
| Actions         | View, Rotate/Replace, Disable                        |

Selecting an identity should open a focused detail view.

Credential enrollment and rotation should use separate guided dialogs with clear consequences.

For example, Rotate Password would show current readiness, whether rotation would reduce coverage, what replacement verification is needed, and what happens to existing sessions.

Do not place the compromise declaration as a shared checkbox above every account. Require it within the specific destructive action dialog, so it cannot accidentally carry over between operations.

The one-time generated recovery password should be shown in a dedicated secure display with a clear acknowledgment before dismissal. Retain the existing backend guarantee that it cannot be retrieved again.

## 9. Establish an enterprise-grade visual language

A world-class management interface does not need more decoration. It needs better hierarchy, predictable spacing and lower cognitive load.

I would use the existing OpsKnight design system, but enforce these standards for the new authentication experience:

| Element           | Design direction                                                           |
| ----------------- | -------------------------------------------------------------------------- |
| Page structure    | Clear heading, concise subtitle, status and a primary action               |
| Content width     | Consistent readable width for forms; wider workspace for tables            |
| Sections          | Fewer nested bordered cards; use dividers and whitespace                   |
| Primary actions   | One dominant action per active workflow                                    |
| Secondary actions | Distinct but clearly clickable outlines                                    |
| Dangerous actions | Separate destructive region and confirmation                               |
| Status            | Consistent text + icon + semantic color, never color alone                 |
| Forms             | Grouped labels, helper text, inline errors and sensible defaults           |
| Tables            | Consistent headers, alignment, row actions, empty states and pagination    |
| Mobile            | Responsive layouts designed explicitly, not just compressed desktop tables |

The same data should be usable at 320–390px mobile width, tablet width, standard laptops and large monitors without clipped menus, stretched form fields or horizontal overflow.

Avoid oversized hero-style cards, excessive badges, gradient blocks and repetitive outlined containers. This is an operational console, not a marketing homepage.

Also restore deep-linkable authentication subsections. The console currently disables URL synchronization; that makes navigation and support harder. Use a nested parameter such as `authTab` so it does not conflict with the outer System Settings `section` parameter.

## 10. Implementation roadmap

I would implement this as six controlled phases, with a separate PR for each meaningful milestone.

### Phase 0 — Correctness and interaction bugs

Highest priority · Required before visual redesign

Fix provider-specific field leakage, cross-tab draft behavior, disabled-action explanations, invalid form handling, stale revision selection and unexpected diagnostic resets. Add regression tests for each confirmed failure.

Exit criterion: An administrator can understand why every action is unavailable and how to resolve it.

### Phase 1 — New page architecture and shared components

Split `AuthenticationConsole.tsx` into focused feature modules. Build reusable components for action prerequisites, status summaries, field groups, revision status, confirmation dialogs and feedback.

Introduce a unified draft coordinator with save/discard, dirty-state protection, field validation and version-conflict handling.

Exit criterion: Each screen has one clear purpose and a predictable workflow.

### Phase 2 — Provider, roles and session-policy redesign

Implement provider-specific forms, tenant-aware Entra setup, understandable advanced settings, callback copy controls, session presets, custom-duration validation and clearer role-mapping configuration.

Separate staging, real-login testing and activation into explicit steps.

Exit criterion: A new administrator can set up a provider without needing to understand internal revision IDs.

### Phase 3 — Diagnostics overhaul

Introduce paginated diagnostic APIs, reusable server-driven tables, session filtering, delivery timelines, audit-event navigation, replica health presentation and stable refresh behavior.

Add appropriate database indexes only after inspecting actual query plans.

Exit criterion: Operators can investigate beyond the first 50–100 records without misleading results or degraded performance.

### Phase 4 — Emergency Recovery and security operations UX

Replace the large account-management form with identity details and guided actions. Improve drill status, password rotation, credential switching, compromised-credential handling and recovery-account navigation.

Exit criterion: Recovery setup and emergency maintenance remain understandable while preserving all existing security restrictions.

### Phase 5 — Enterprise certification and polish

Run browser, accessibility, performance and upgrade regressions. Verify responsiveness, focus management, protected operations, permissions, empty states and large-record pagination.

Exit criterion: No known P1/P2 interaction defect, consistent behavior across supported viewports, and full SSO regression certification.

## 11. Files and architecture to modify

| Existing file                     | Proposed responsibility                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `AuthenticationConsole.tsx`       | Lightweight coordinator and navigation, not the entire implementation                 |
| `AuthenticationOverview.tsx`      | Operational status dashboard                                                          |
| `AuthenticationDiagnostics.tsx`   | Diagnostics navigation and focused subviews                                           |
| `AuthenticationUserDirectory.tsx` | Reusable server-side paginated account directory                                      |
| `AuthenticationAdminPicker.tsx`   | Searchable, explicit administrator selection and read-only current-admin presentation |
| `AuthenticationRoleRules.tsx`     | Guided role-mapping editor and validation                                             |
| `SsoSettingsForm.tsx`             | Reference for the old successful session presets and provider guidance                |
| `dashboard.ts`                    | Separate lightweight summary queries from paginated detailed queries                  |
| `provider-config.ts`              | Provider-aware configuration validation while preserving compatibility                |
| `oidc-revisions.ts`               | Preserve the authoritative stage → test → activate lifecycle                          |
| `prisma/schema.prisma`            | Add only necessary pagination/filter indexes                                          |

Recommended new modules would include `AuthenticationProviderForm`, `AuthenticationSessionPolicyForm`, `AuthenticationActionGuard`, `AuthenticationDraftCoordinator`, `RecoveryAccountDetails`, `DiagnosticsSessionsTable`, `DiagnosticsDeliveryTable`, `DiagnosticsAuditTable`, and a shared pagination component.

These names are implementation suggestions, not existing files.

## 12. Comprehensive validation requirements

The redesigned UI should be tested against an explicit matrix, not judged only by screenshots.

| Test group             | Required coverage                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Provider configuration | Entra, Google, Okta, Auth0, custom issuer, switching providers, preserved secrets                  |
| State management       | Cross-tab edits, unsaved changes, cancel/reload, concurrent admin edits, stale revisions           |
| Action eligibility     | Every blocked action explains its reason; valid actions execute                                    |
| Session policies       | Presets, custom values, defaults, invalid durations and saved-policy reload                        |
| SSO lifecycle          | New setup, stage, test, activate, rollback, optional/required mode                                 |
| Recovery               | Two-password, two-key, mixed identities, rotation, disable, drills, compromised credentials        |
| Diagnostics            | Large result sets, filter correctness, page boundaries, previous/next navigation                   |
| Failure handling       | API timeouts, expired sessions, revoked permissions, network loss, database unavailability         |
| Responsive UX          | Mobile, tablet, laptop and wide monitors                                                           |
| Accessibility          | Keyboard-only operation, focus behavior, screen-reader labels, WCAG AA contrast                    |
| Regression             | Existing users, sessions, identities, OIDC sign-in, SCIM, incident access and upgraded deployments |

For pagination specifically, test empty, 1, 24, 25, 26, 50, 100, 10,000 and 100,000-record datasets. Test stable ordering with identical timestamps, status changes during pagination, invalid cursors, and requests that arrive out of order.

For buttons, build automated component tests that verify every disabled state has a visible and accessible explanation.

For visual QA, use Playwright screenshots at representative widths, browser interaction tests, accessibility scanning and manual review of the actual rendered pages.

The existing Playwright suite covers important security and recovery flows, but it does not yet certify this full UX matrix.

## 13. Non-negotiable compatibility requirements

This is a UI overhaul; it must not accidentally become an authentication-engine rewrite.

Preserve the current encrypted secrets and stored provider configuration; revision staging and real OIDC test requirements; administrator account linking and role mapping; SSO Required enforcement; independent emergency-password and hardware-key recovery; restricted recovery sessions; security audit logging; and existing v2.0.0 upgrade compatibility.

New UI configuration should be managed in the application wherever practical. No additional `.env` feature flags should be required just to control these workflows.

A UI feature should be considered complete only when its backend behavior, documentation and test evidence match what the interface claims.

## 14. What I would prioritize first

This is my recommended order of importance:

1. Fix the functionality and disabled-button confusion before changing colors or layout.
2. Restore provider-specific configuration and session-duration presets.
3. Replace the fragmented setup with a clear guided flow and unified draft handling.
4. Rebuild Diagnostics with proper server-side pagination, filtering and drill-downs.
5. Redesign Emergency Recovery management.
6. Complete visual consistency, accessibility and end-to-end certification.

The design philosophy should follow the strongest parts of mature enterprise products: progressive disclosure, informative validation, predictable tables and meaningful system feedback. Carbon, PatternFly and Atlassian all emphasize variations of these principles.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.carbondesignsystem.com\&sz=32)

Carbon Design System

+2



Final recommendation: Treat this as a dedicated Enterprise Authentication Experience V2 workstream. Do not patch the 1,492-line console indefinitely. Keep the certified authentication backend stable, rebuild the administration interface as smaller, purpose-driven components, and use real task-completion and regression tests as the acceptance gate.

That is the path from a technically advanced but confusing screen to an enterprise-grade administration experience.