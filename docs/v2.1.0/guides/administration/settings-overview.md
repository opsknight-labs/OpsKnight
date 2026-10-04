---
title: Find and use workspace settings
description: Map each Settings group to its owner, purpose, and detailed workflow.
type: how-to
product_area: administration
audience: [responder, administrator, operator]
reader: { status: READER_COMPLETE, task: "Find the correct Settings area for an account, workspace, integration, notification, or system change." }
verification:
  level: source
  verified_at: 2026-10-02
  evidence: [src/app/(app)/settings/page.tsx, src/components/settings/navConfig.ts]
---

# Find and use workspace settings

## Before you begin

Identify whether the change is personal, workspace-wide, integration-specific,
or operational. Settings cards are permission-aware; administrator/auditor badges
identify areas that may be hidden or read-only for your account.

## Open the feature

Open **Settings** or `/settings`. Use the Settings search when you know the
feature or a related keyword. Read the card's description and live status before
opening it.

## Configure through Settings

1. Select the group that owns the change using the map below.
2. Open the card and confirm its scope, current state, and required role.
3. Follow the linked feature guide before changing a credential, identity rule,
   routing policy, retention setting, or other high-impact control.
4. Save the smallest intended change and verify it in the consuming workflow.
5. Record and audit the result according to your change-management policy.

## Choose the correct settings area

### Account and identity

- **Profile & Preferences:** personal name, timezone, delivery preferences,
  quiet hours, and current membership/on-call context.
- **Security & Sessions:** password and signed-in session review/revocation.
- **OIDC and SCIM:** use the identity guides when deploying centralized login or
  lifecycle provisioning; configuration visibility depends on administration.

### Workspace and governance

- **Incident Response Policy:** classification and immutable incident SLA rules.
- **Custom Fields:** incident metadata types and validation.
- **Public Status Page:** the single public page, branding, domain, subscribers,
  and update behavior.
- **API Keys & Access Tokens:** user/admin programmatic credentials.
- **Audit Log Stream:** review/export workspace change events.
- **Security & Compliance:** control readiness and evidence.
- **Privacy Requests:** DSAR intake, export, erasure, and retention workflows.

### Integrations and ChatOps

- **Slack Workspace / Microsoft Teams:** tenant/workspace connection and ChatOps
  transport configuration.
- **ChatOps War-Rooms:** global automatic war-room/provider behavior.
- **Jira Issue Tracking:** connection, webhook, and issue synchronization.
- *(Inbound monitoring and alert-source integrations are configured per-service under **Services → [Service] → Integrations**.)*

### Notifications

- **Notification Providers:** administrator credentials and channel enablement.
- **Notification Operations:** operational state and provider health/work queues.
- **Delivery History:** individual attempts, outcomes, and failure evidence.
- Personal opt-in and quiet hours remain under **Profile & Preferences**.

### System and reliability

- **System Health Center:** runtime dependencies and actionable health state.
- **System:** deployment-backed system configuration and provider settings.
- **System Logs:** searchable runtime log records available to the operator role.

## How Settings works

The landing page is an information architecture and status surface, not a bulk
configuration form. Cards can display connection or record summaries, but the
owning page performs the change. Permissions are enforced again by the target
page/API; hiding a card is not the security boundary.

## Verify the result

After a change, return to Settings and confirm the card/live summary reflects the
expected state where one is provided. Then verify the feature itself: send a test
notification, perform an identity test, inspect health, or exercise the relevant
incident workflow. Record high-risk changes in the change ticket and Audit Log.

## Change or undo it

Undo a change in its owning page, following that guide's rotation, disconnect,
or rollback procedure. Do not delete a provider, identity configuration, or API
credential before dependents have moved to a tested replacement.

## Troubleshooting

- **A card is missing:** verify role, account status, and required capability.
- **Settings search has no match:** search by feature and synonym, then use the
  grouped map above; product-wide record search is a separate control.
- **A live status is stale:** open the target page and verify the source record;
  return/reload after the change.
- **A save succeeds but behavior is unchanged:** verify runtime configuration,
  provider connectivity, routing, user preference, and audit/delivery evidence.

## Next steps

- [Manage permissions](./manage-permissions)
- [Manage profile and preferences](../profile/manage-profile-and-preferences)
- [Configure notification providers](../notifications/configure-provider)
- [Configure Slack](../../integrations/communication/slack/connect-with-oauth)
- [Configure Microsoft Teams](../../integrations/communication/microsoft-teams/connect)
