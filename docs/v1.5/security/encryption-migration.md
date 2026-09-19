---
order: 4
title: Encryption Migration & Key-Retirement Readiness
description: Controlled database migration to AES-256-GCM v3 and authoritative key-retirement verification
---

# Encryption Migration & Key-Retirement Readiness

OpsKnight includes built-in, auditable database encryption migration and key-retirement verification. This provides an authoritative, non-destructive path to upgrade legacy ciphertext (v1/v2 AES-CBC) and re-encrypt old-key secrets (v3 AES-GCM) to your active primary key without downtime or race conditions.

## Architectural Boundaries

To maintain clear separation of responsibilities between application and infrastructure:

- **What OpsKnight Does**:
  - Registers every database field protected by the encryption keyring across all models.
  - Classifies ciphertext formats (`CURRENT_V3`, `OLD_KEY_V3`, `LEGACY_V2`, `LEGACY_V1`, `PLAINTEXT`, `UNAVAILABLE_KEY`, `AMBIGUOUS`, `UNREADABLE`) without ever logging or exposing plaintext secrets.
  - Previews migration impact non-destructively.
  - Performs atomic Compare-And-Swap (CAS) re-encryption to active AES-256-GCM v3 to protect against concurrent credential updates.
  - Checkpoints batch progress per target.
  - Runs fresh, independent verification scans against the exact registry fingerprint.
  - Reports database-side key retirement readiness ("Database ready for operator retirement of key `k1`").
  - Emits structured audit events (`ENCRYPTION_MIGRATION`) to track operations.

- **What Operators Manage**:
  - Operators generate master keys using external tools or secret managers.
  - Operators configure `ENCRYPTION_KEYS` in deployment environments (e.g. Kubernetes Secrets, AWS Secrets Manager, Vault, `.env`).
  - Operators remove retired keys from environment variables after OpsKnight verifies database readiness and after verifying backup/replica retention policies.
  - OpsKnight **never** claims that database backups, WAL archives, or offline replicas are migrated.

## End-to-End Zero-Downtime Key Rotation Procedure

Follow this 5-step workflow to rotate an encryption key and retire the previous key:

```text
1. GENERATE NEW KEY
   openssl rand -hex 32

2. DEPLOY OVERLAPPING KEYRING
   ENCRYPTION_KEYS=k2:NEW_KEY,k1:OLD_KEY
   (New writes automatically use k2; k1 remains available for decryption)

3. PREVIEW & MIGRATE IN COMPLIANCE UI
   Navigate to /settings/security-compliance -> Encryption & Keys
   Click "Preview Impact" -> Click "Start Migration (CAS)"

4. VERIFY DATABASE INTEGRITY
   Click "Verify Integrity"
   Confirm status reports: "Ready for Operator Retirement of key k1"

5. RETIRE OLD KEY FROM ENVIRONMENT
   Update deployment secrets: ENCRYPTION_KEYS=k2:NEW_KEY
   Deploy updated configuration
```

## Supported Target Registry

OpsKnight actively tracks and protects 17 distinct targets across database models:

- **Identity & SSO**: `OidcConfig.clientSecret`
- **Slack Integrations**: `SlackIntegration.botToken`, `SlackIntegration.signingSecret`, `SlackOAuthConfig.clientSecret`, `SlackOAuthConfig.signingSecret`
- **Jira**: `JiraConfig.apiTokenEncrypted`, `JiraConfig.webhookSecretEncrypted`
- **Microsoft Teams**: `MicrosoftTeamsConfig.clientSecret`
- **Inbound Integrations & Webhooks**: `Integration.signatureSecret`, `WebhookIntegration.secret`, `StatusPageWebhook.secret`
- **Notification Infrastructure**: `NotificationProvider.config` (all provider secrets including `accountSid`, `authToken`, `whatsappAccountSid`, `whatsappAuthToken`, `accessKeyId`, `secretAccessKey`, `vapidPrivateKey`, `apiKey`, `password`, as well as nested `vapidKeyHistory[].privateKey`), `Notification.payloadEncrypted`, `NotificationContent.encryptedTemplate`
- **ChatOps & Privacy**: `ChatOpsIntent.encryptedPayload`, `PrivacyExportArtifact.encryptedPayload`
- **User Devices**: `UserDevice.token` (Web Push subscription tokens)

## Concurrency Protection (Compare-And-Swap)

During automated batch migration, another administrator or integration might update a credential concurrently. To prevent overwriting fresher credentials:

- **Scalar fields**: Updated with `WHERE id = :id AND field = :originalValue`. If the update affects 0 rows, it is recorded as a conflict (`conflictRecords++`) and left untouched for subsequent inspection.
- **Provider JSON configs**: Uses optimistic CAS with `updatedAt` versioning: `WHERE id = :id AND updatedAt = :versionRead`. If the record was modified in the interim, the update affects 0 rows and is recorded as a conflict without mutating the newer configuration.

## Key Retirement Readiness Certification Criteria

Before OpsKnight authoritatively certifies a key as `DATABASE_READY_FOR_RETIREMENT`:

1. A fresh `VERIFY` run must have completed with a matching schema registry fingerprint.
2. All 17 registered encryption targets must have completed scanning (`status: 'COMPLETED'`).
3. The verification run must have detected 0 error records (`unreadable`, `ambiguous`, `unavailableKey`) and 0 unresolved conflicts.
4. The candidate key must have 0 detected references in the database.
5. If legacy database fallback key (`SystemSettings.encryptionKey`) is configured, it is evaluated identically under key ID `database_legacy`.

## Permissions & Compliance Audits

- `encryption.read` (granted to `ADMIN` and `AUDITOR`): Inspect keyring status, target statistics, migration runs, and key retirement reports.
- `encryption.manage` (granted to `ADMIN`): Initiate preview, migration, or verification runs, and cancel running operations.
- Every migration or verification run is logged in the immutable compliance audit trail with entity type `ENCRYPTION_MIGRATION`.
