# MCP exclusion review packet

This packet lists every operation still open in the MCP parity inventory, with a proposed disposition. It was generated from `npm run --silent mcp:coverage` to help reviewers; it does not record any decision. Automated tooling must not author `exclusion` records. An exclusion counts only when a named reviewer records it in `src/lib/mcp/catalog/review.json`. The record needs a date, a rationale of at least 20 characters, and a safe equivalent where one exists. The schema rejects anything else.

Snapshot: 76 open operations of 320. Proposed: implement 1, exclude 75. Regenerate the inventory before reviewing. The operation IDs, risks and reasons below come from the registry.

## How to record a decision

1. Confirm the operation, its risk class and the current reason in the coverage artifact.
2. For an exclusion, add an `exclusion` object to the operation in `review.json`: `reviewer`, `reviewedAt` (`YYYY-MM-DD`), `rationale`, and `safeEquivalent` (or `null`). Keep its status as `DENIED_WITH_REASON` or `UNSUPPORTED_WITH_REASON`.
3. For an implementation, follow the approval batch process in [full-parity delivery](./full-parity.md). Never re-label an operation to raise coverage.
4. Run `npm run --silent mcp:coverage` and the parity unit tests. The artifact reports the reviewed count as `reviewedExclusions`.

## Blocked on a transactional domain command (no durable receipt or single transaction) (1)

Proposed disposition: **Implement**.

| Operation          | Risk | Method | Current reason                                                                                                                                                                                                             | Reviewer | Date | Decision |
| ------------------ | ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- | -------- |
| `updateStatusPage` | R2   | PATCH  | Not exposed: disabling a page withdraws the public projection before the transaction (a deliberate privacy guarantee) and no-op updates open no transaction, so an approval cannot be recorded atomically with the effect. |          |      |          |

## Superseded by an approval-gated equivalent (1)

Proposed disposition: **Exclude**.

| Operation       | Risk | Method | Current reason                                                                                                                                          | Reviewer | Date | Decision |
| --------------- | ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- | -------- |
| `deleteRunbook` | R3   | DELETE | Proposed exclusion (pending named review): native rules forbid deleting a runbook with published versions; use archiveRunbook (approval-gated) instead. |          |      |          |

## Exceeds MCP request bounds (1)

Proposed disposition: **Exclude**.

| Operation               | Risk | Method | Current reason                                                                                                                                                               | Reviewer | Date | Decision |
| ----------------------- | ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- | -------- |
| `uploadStatusPageAsset` | R2   | POST   | Proposed exclusion (pending named review): a base64 image body of up to 2.8 MB exceeds the 64 KiB MCP request bound by design; upload through the native status-page editor. |          |      |          |

## Response or binding unsafe for a model (7)

Proposed disposition: **Exclude**.

| Operation                      | Risk | Method | Current reason                                                                                                                                                                                                                                     | Reviewer | Date | Decision |
| ------------------------------ | ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- | -------- |
| `cancelReportExport`           | R2   | POST   | Not exposed: cancellation is scoped to the creating API key, and MCP cannot create exports (see createReportExport).                                                                                                                               |          |      |          |
| `createReportExport`           | R2   | POST   | Not exposed: exports are bound to an API-key row and MCP principals have none, so an approved export could never be produced or downloaded.                                                                                                        |          |      |          |
| `createServiceIntegration`     | R2   | POST   | Not exposed: the response discloses the new integration key in clear, so it needs a rotation-style workflow that never returns the secret to an agent.                                                                                             |          |      |          |
| `downloadReportDashboardData`  | R2   | GET    | Proposed exclusion (pending named review): bulk data download; agents should use getReportDashboardData.                                                                                                                                           |          |      |          |
| `downloadReportExport`         | R2   | GET    | Proposed exclusion (pending named review): file export bound to API-key rows MCP principals do not have.                                                                                                                                           |          |      |          |
| `getReportExport`              | R2   | GET    | Proposed exclusion (pending named review): exports are bound to API-key rows MCP principals do not have.                                                                                                                                           |          |      |          |
| `previewRunbookExecutionRerun` | R2   | POST   | Not exposed: the preview returns a rerun authorization token that would let the holder start execution; a model must never receive it. Proposed exclusion (pending named review); safe equivalent is runbook_prepare_execution with native review. |          |      |          |

## Credential and secret material (24)

Proposed disposition: **Exclude**.

| Operation                            | Risk | Method | Current reason                                                                            | Reviewer | Date | Decision |
| ------------------------------------ | ---- | ------ | ----------------------------------------------------------------------------------------- | -------- | ---- | -------- |
| `activateRunbookSigningIdentity`     | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `configureNotificationProvider`      | R3   | PUT    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `createRunbookAgentEnrollment`       | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `createRunbookSecret`                | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getIntegrationCredentialState`      | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getNotificationProvider`            | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getNotificationProviderDiagnostics` | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getRunbookAgentEnrollment`          | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getRunbookSecret`                   | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `grantRunbookSecret`                 | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `issueServiceAccountToken`           | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `listNotificationProviders`          | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `listRunbookSecretGrants`            | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `listRunbookSecretUsage`             | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `listRunbookSecrets`                 | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `listRunbookSigningIdentities`       | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `retireRunbookSigningIdentity`       | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `revokeRunbookSecretGrant`           | R3   | DELETE | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `revokeServiceAccountToken`          | R3   | DELETE | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `rotateIntegrationCredentials`       | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `rotateRunbookSecret`                | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `rotateWebPushKeys`                  | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `stageRunbookSigningIdentity`        | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `testNotificationProvider`           | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |

## Identity and access administration (13)

Proposed disposition: **Exclude**.

| Operation                 | Risk | Method | Current reason                                                                            | Reviewer | Date | Decision |
| ------------------------- | ---- | ------ | ----------------------------------------------------------------------------------------- | -------- | ---- | -------- |
| `administerUser`          | R3   | PATCH  | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `createServiceAccount`    | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `createUserInvitation`    | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `deleteServiceAccount`    | R3   | DELETE | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getServiceAccount`       | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getUser`                 | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getUserAdministration`   | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getUserDependencies`     | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getUserInvitation`       | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getUserInvitationPolicy` | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `listServiceAccounts`     | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `listUsers`               | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `renewUserInvitation`     | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |

## Runbook execution infrastructure (agents and pools) (16)

Proposed disposition: **Exclude**.

| Operation                         | Risk | Method | Current reason                                                                            | Reviewer | Date | Decision |
| --------------------------------- | ---- | ------ | ----------------------------------------------------------------------------------------- | -------- | ---- | -------- |
| `checkRunbookAgentPoolDeletion`   | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `createRunbookAgentPool`          | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `deleteRunbookAgentPool`          | R3   | DELETE | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getRunbookAgent`                 | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getRunbookAgentConfiguration`    | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getRunbookAgentPolicyStatus`     | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getRunbookAgentPool`             | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `listRunbookAgentPoolMembers`     | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `listRunbookAgentPools`           | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `listRunbookAgents`               | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `removeRunbookAgentPoolMember`    | R3   | DELETE | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `retireRunbookAgentPool`          | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `revokeRunbookAgent`              | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `setRunbookAgentPoolMember`       | R3   | PUT    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `updateRunbookAgentConfiguration` | R3   | PATCH  | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `updateRunbookAgentPool`          | R3   | PATCH  | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |

## Audit evidence (4)

Proposed disposition: **Exclude**.

| Operation             | Risk | Method | Current reason                                                                            | Reviewer | Date | Decision |
| --------------------- | ---- | ------ | ----------------------------------------------------------------------------------------- | -------- | ---- | -------- |
| `createAuditExport`   | R3   | POST   | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `downloadAuditExport` | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `getAuditExport`      | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |
| `listAuditLogs`       | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration. |          |      |          |

## Personal data and personal paging settings (5)

Proposed disposition: **Exclude**.

| Operation                         | Risk | Method | Current reason                                                                                         | Reviewer | Date | Decision |
| --------------------------------- | ---- | ------ | ------------------------------------------------------------------------------------------------------ | -------- | ---- | -------- |
| `getMyNotificationPreferences`    | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration.              |          |      |          |
| `getStatusPageSubscriber`         | R2   | GET    | Proposed exclusion (pending named review): subscriber personal data; use getStatusPageSubscriberStats. |          |      |          |
| `listStatusPageSubscribers`       | R2   | GET    | Proposed exclusion (pending named review): subscriber personal data; use getStatusPageSubscriberStats. |          |      |          |
| `removeStatusPageSubscriber`      | R3   | DELETE | Credential, personal-data or infrastructure boundary restricted to native administration.              |          |      |          |
| `updateMyNotificationPreferences` | R3   | PATCH  | Credential, personal-data or infrastructure boundary restricted to native administration.              |          |      |          |

## Configuration that can carry endpoint secrets or access controls (4)

Proposed disposition: **Exclude**.

| Operation                   | Risk | Method | Current reason                                                                                                                                 | Reviewer | Date | Decision |
| --------------------------- | ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- | -------- |
| `getChatOpsConfiguration`   | R2   | GET    | Proposed exclusion (pending named review): ChatOps configuration contains webhook URLs whose path is itself a credential.                      |          |      |          |
| `getIntegration`            | R2   | GET    | Proposed exclusion (pending named review): integration configuration can carry endpoint secrets; use listIntegrations and getIntegrationUsage. |          |      |          |
| `getIntegrationDiagnostics` | R2   | GET    | Proposed exclusion (pending named review): diagnostics can echo endpoint and header configuration.                                             |          |      |          |
| `getStatusPagePrivacy`      | R3   | GET    | Credential, personal-data or infrastructure boundary restricted to native administration.                                                      |          |      |          |
