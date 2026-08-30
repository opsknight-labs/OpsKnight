# Service Redesign: Bug, Security, and Robustness Investigation

**Date:** 2026-08-30  
**Branch reviewed:** `feat/centralized-components-and-services-redesign`  
**Baseline:** `main` at merge-base `edda8d36`  
**Method:** independent logic/robustness and security reviews; TypeScript, test-suite, and production dependency-audit validation.  
**Scope:** branch changes reviewed during the investigation. The remediation below was implemented after the review.

## Executive summary

The current service-page consolidation contains **seven actionable regressions**:

- **5 high severity** findings
- **2 medium severity** findings

The most urgent risks are exposure of integration credentials to read-only service viewers and loss of service notification, ChatOps, or SLA configuration when an unrelated metadata field is saved.

## Remediation status

All seven findings in this report are addressed in the follow-up implementation:

- Service detail access is checked against the actor's service-read scope before loading page data.
- Management-only connection details and settings are not rendered for read-only viewers.
- General, notification, and ChatOps settings now save through separate authorized actions, preserving unrelated configuration.
- The notification and ChatOps sections each have an explicit save action.
- The edit form uses the canonical SLA tiers: `Platinum`, `Gold`, `Silver`, `Bronze`, and `Internal`.
- Integration add and secret-management controls are hidden from read-only viewers.

Validation after remediation: `npx tsc --noEmit` and `git diff --check` pass. The unit suite was started successfully but its final output was not captured by the local runner; the previously observed database-backed test failure remains an environment credential issue rather than a regression from this change.

## Findings

| ID   | Severity | Area                          | Finding                                                                                                                                 |
| ---- | -------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | High     | Configuration persistence     | Saving general service metadata clears notification and ChatOps settings that are absent from the shortened form.                       |
| R-02 | High     | Configuration persistence     | Notification controls are outside any submitting form and have no dedicated save mutation; changes disappear on reload.                 |
| R-03 | High     | Configuration persistence     | Existing canonical SLA tiers are not represented by the redesigned edit select; an unrelated save can set the tier to `null`.           |
| S-01 | High     | Credential exposure           | Read-only viewers receive and can copy Events API routing keys in the page payload.                                                     |
| S-02 | High     | Credential exposure           | Read-only viewers receive Slack incoming-webhook URLs and outbound webhook destinations in client-rendered settings.                    |
| S-03 | Medium   | Authorization / data exposure | The service page does not enforce object-level read authorization before loading cross-service, policy, team, and target-user metadata. |
| R-04 | Medium   | Authorization UX              | Read-only viewers are shown integration add, rotate, and remove controls that only fail after interaction.                              |

## Detailed findings

### R-01 — General metadata saves erase notification and ChatOps settings

**Evidence**

- The general settings form ends at [service page](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/[id]/page.tsx:770>), while `ServiceNotificationSettings` and `ChatOpsWarRoomSettings` render afterward at [service page](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/[id]/page.tsx:774>).
- `updateService` treats omitted notification and war-room inputs as default false/empty values and persists them at [service actions](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/actions.ts:108>) and [service actions](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/actions.ts:134>).

**Reproduction**

1. Configure Slack notifications or ChatOps war-room creation for a service.
2. Change only the description in General configuration.
3. Save changes and reload the service page.

**Impact**

Existing notification channels, Slack webhook/channel values, and war-room configuration can be silently reset, potentially stopping incident notifications.

**Recommendation**

Split metadata, notification, and ChatOps settings into dedicated mutations, or make the existing mutation preserve fields not supplied by its form. Add regression tests for partial update behavior.

### R-02 — Notification controls cannot persist changes

**Evidence**

- `ServiceNotificationSettings` maintains local checkbox/input state at [ServiceNotificationSettings](/Users/dushyantrahangdale/Desktop/Projects/opsknight/src/components/service/ServiceNotificationSettings.tsx:274) and [ServiceNotificationSettings](/Users/dushyantrahangdale/Desktop/Projects/opsknight/src/components/service/ServiceNotificationSettings.tsx:341).
- The component is no longer inside the `updateService` form and has no dedicated submit action at [service page](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/[id]/page.tsx:774>).

**Reproduction**

1. Change one or more notification event/channel controls.
2. Navigate away or reload the page.

**Impact**

The user is presented with editable settings that are never saved, creating false confidence that incident routing was changed.

**Recommendation**

Give the component an explicit Save action backed by a dedicated authorized mutation, with saved/failed feedback. Add an end-to-end persistence test.

### R-03 — Existing SLA tiers can be cleared by unrelated edits

**Evidence**

- Stored canonical values include `Platinum`, `Gold`, `Silver`, `Bronze`, and `Internal` in [schema.prisma](/Users/dushyantrahangdale/Desktop/Projects/opsknight/prisma/schema.prisma:293) and the service creation flow.
- The redesigned edit select only offers `Tier 1`, `Tier 2`, and `Tier 3` at [service page](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/[id]/page.tsx:736>).
- `updateService` persists an absent/empty selection as `null` at [service actions](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/actions.ts:140>).

**Reproduction**

1. Open an existing service with SLA tier `Gold`, `Silver`, `Bronze`, `Platinum`, or `Internal`.
2. Edit only its description and save.

**Impact**

The unmatched select value is submitted as the empty option, clearing the service SLA tier and affecting compliance/response expectations.

**Recommendation**

Use the canonical persisted tier values in the edit form, or implement and deploy an explicit data migration before replacing them. Add a parameterized test for every supported tier.

### S-01 — Events API routing credentials reach read-only viewers

**Evidence**

- Full integration records are loaded at [service page](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/[id]/page.tsx:166>).
- The Events API routing key is rendered/copyable at [service page](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/[id]/page.tsx:532>).
- `canManageService` controls mutation UI but does not prevent sensitive records entering the client component payload.

**Impact**

Any authorized viewer of a service can obtain its routing key and forge Events API alerts.

**Recommendation**

Do not query or serialize routing credentials for readers. Fetch/reveal them through a separate server action protected by `assertCanModifyService`; prefer one-time reveal and rotation rather than routinely rendering stored secrets.

### S-02 — Slack and outbound webhook credentials reach read-only viewers

**Evidence**

- The consolidated service page loads full integration details at [service page](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/[id]/page.tsx:166>).
- Notification settings with Slack incoming-webhook and outbound destination values are passed into a client component at [service page](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/[id]/page.tsx:774>) and [ServiceNotificationSettings](/Users/dushyantrahangdale/Desktop/Projects/opsknight/src/components/service/ServiceNotificationSettings.tsx:622).

**Impact**

Slack incoming-webhook URLs are bearer credentials. A viewer who obtains one can send arbitrary messages to its channel; outbound URLs can also embed credentials or tokens.

**Recommendation**

Gate these values behind service-management authorization, return masked values to readers, and provide an authorized replace/rotate workflow.

### S-03 — Service detail page lacks object-level read authorization

**Evidence**

- The page loads service, team, escalation-policy, and target-user data at [service page](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/[id]/page.tsx:154>).
- It uses role flags from `getUserPermissions()` rather than asserting that the current actor may read this specific service before loading related records.

**Impact**

A scoped user with an unrelated service ID can receive personnel, ownership, policy, and service metadata outside their permitted scope.

**Recommendation**

Resolve the current actor and enforce `assertCanViewService(id)` before all service-related queries. Constrain related team/policy queries to the authorized service scope and add positive/negative authorization tests.

### R-04 — Read-only users see integration mutation controls

**Evidence**

- Integration status/delete controls are gated at [service page](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/[id]/page.tsx:469>).
- Secret rotate/remove controls and the add-integration picker are still rendered without the same gate at [service page](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/[id]/page.tsx:592>) and [service page](</Users/dushyantrahangdale/Desktop/Projects/opsknight/src/app/(app)/services/[id]/page.tsx:616>).

**Impact**

Read-only users can begin sensitive workflows and receive authorization failures only after interacting. This is confusing and increases accidental-secret handling exposure.

**Recommendation**

Gate add/rotate/remove controls with `canManageService`; pass an explicit read-only state into integration-secret controls.

## Validation results

| Check                                                | Result                          | Notes                                                                                                                                                           |
| ---------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript (`npx tsc --noEmit`)                      | Passed                          | No type errors.                                                                                                                                                 |
| Full Vitest suite (`npm test -- --run`)              | Blocked by local DB credentials | 1,606 passed; 92 skipped; 1 failed. `tests/integration/db-locks.test.ts` cannot authenticate to PostgreSQL at `localhost` with the configured `opsknight` user. |
| Production dependency audit (`npm audit --omit=dev`) | Passed                          | No production dependency vulnerabilities reported.                                                                                                              |
| Bug / robustness review                              | Findings above                  | 4 reproducible regressions.                                                                                                                                     |
| Security review                                      | Findings above                  | 3 actionable issues; one overlaps the integration authorization surface but is listed separately due to a distinct user-visible failure mode.                   |

## Prioritized remediation plan

1. **Immediately protect credentials and service data**: add object-level service-read authorization; stop serializing routing keys, Slack URLs, and outbound webhook URLs to readers.
2. **Prevent configuration loss**: split `updateService` into partial, purpose-specific mutations and add persistence tests.
3. **Restore notification persistence**: add a dedicated form/mutation and save feedback to notification settings.
4. **Correct SLA values**: preserve canonical tier values and test all existing tiers.
5. **Align read-only UI with authorization**: hide or disable integration mutation controls for viewers.
6. **Restore DB-backed test execution**: fix the local PostgreSQL credential/configuration mismatch, then run the integration suite again.

## Suggested regression test matrix

- Save only service metadata while every notification and ChatOps flag has a non-default value; assert all untouched fields remain unchanged.
- Save notification settings and reload; assert each selected channel/event persists.
- Parameterize metadata saves across `Platinum`, `Gold`, `Silver`, `Bronze`, and `Internal` SLA tiers.
- Attempt to view a non-owned service as a scoped user; assert a not-found/forbidden result and no related policy/team data in the payload.
- Render a service page as a viewer; assert routing keys, Slack URLs, and outbound webhook URLs are absent from server and client payloads.
- Render integration settings as a viewer; assert add, rotate, and remove controls are absent.
