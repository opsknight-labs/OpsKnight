---
order: 2
title: Encryption
description: How OpsKnight encrypts sensitive credentials and how to configure the master key
---

# Encryption

OpsKnight encrypts sensitive secrets — SSO client secrets, Slack tokens, VAPID keys, SMTP passwords, and API keys — at rest using AES-256-CBC **Envelope Encryption**.


---

## How It Works

OpsKnight uses a two-layer **Envelope Encryption** model (V2):

```
ENCRYPTION_KEY (Master Key — from env var)
        │
        ▼
  Encrypt a unique DEK (Data Encryption Key) per secret
        │
        ▼
    DEK encrypts the actual secret
        │
        ▼
  Stored in database: v2:<dekIv>:<encryptedDek>:<payloadIv>:<encryptedPayload>
```

**Why Envelope Encryption?**

- The master key only ever encrypts small DEKs, not the raw secrets directly.
- Each secret has its own unique DEK — compromising one ciphertext does not expose others.
- Fast key rotation: only DEKs need re-encryption, not the entire dataset.

---

## Setting the Encryption Key

The master encryption key is configured **entirely through the `ENCRYPTION_KEY` environment variable**. There is no UI for key management — this is intentional and follows [12-factor app](https://12factor.net/config) security best practices: credentials belong in the environment, not in the database.

### Generating a Key

```bash
# Generate a cryptographically secure 32-byte (256-bit) hex key
openssl rand -hex 32
```

This outputs a 64-character hex string, for example:

```
a3f1c2e4b5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2
```

### Setting the Variable

**Docker Compose / `.env` file**:

```bash
# .env
ENCRYPTION_KEY=a3f1c2e4b5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2
```

**Kubernetes Secret**:

```bash
kubectl create secret generic opsknight-secrets \
  --from-literal=ENCRYPTION_KEY=$(openssl rand -hex 32)
```

Then reference it in your deployment:

```yaml
env:
  - name: ENCRYPTION_KEY
    valueFrom:
      secretKeyRef:
        name: opsknight-secrets
        key: ENCRYPTION_KEY
```

**Helm values**:

```yaml
secrets:
  ENCRYPTION_KEY: 'your-64-char-hex-key'
```

> **Security**: Never commit the `ENCRYPTION_KEY` value to source control. Use a secrets manager (AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager) in production.

---

## Development Mode

When `NODE_ENV=development` and `ENCRYPTION_KEY` is not set, OpsKnight automatically falls back to a stable, well-known developer key. This means:

- Local development works out of the box with **zero configuration**.
- No secrets are at risk — the dev key is not secret and is only used for local testing.
- A warning is printed to the server console so you know it's active.

> **Do not use the development fallback in production.** Always set `ENCRYPTION_KEY` explicitly in any environment that stores real credentials.

---

## What Gets Encrypted

The following fields are encrypted at rest before being written to the database:

| Integration       | Field(s) Encrypted               |
| ----------------- | -------------------------------- |
| **Jira Cloud**    | `apiToken`, `webhookSecret`      |
| **SSO / OIDC**    | `clientSecret`                   |
| **Slack**         | `botToken`, `signingSecret`      |
| **Slack OAuth**   | `clientSecret`                   |
| **Twilio**        | `authToken`, `whatsappAuthToken` |
| **AWS SNS / SES** | `secretAccessKey`                |
| **Resend**        | `apiKey`                         |
| **SendGrid**      | `apiKey`                         |
| **SMTP**          | `password`                       |
| **Web Push**      | `vapidPrivateKey`                |

Fields not in this list (e.g., public keys, provider names, account SIDs) are stored in plaintext.

---

## Key Rotation

Key rotation is the process of replacing your master key with a new one. Since OpsKnight uses envelope encryption, rotation requires re-encrypting the per-secret DEKs — the raw secrets themselves do not change.

### Steps

1. **Generate a new key**:

   ```bash
   openssl rand -hex 32
   ```

2. **Decrypt existing secrets** with the old key (using your own tooling or a migration script that calls `decryptWithKey(ciphertext, oldKey)`).

3. **Re-encrypt each secret** with the new key (`encryptWithKey(plaintext, newKey)`).

4. **Update `ENCRYPTION_KEY`** in your deployment environment or secrets manager.

5. **Redeploy** the application.

> If you use a secrets manager that supports automatic secret rotation (e.g., AWS Secrets Manager), point `ENCRYPTION_KEY` to the latest version and redeploy. No data migration is needed if you manage rotation at the secrets manager level with version-aware decryption.

### Rotation Frequency

We recommend rotating the encryption key:

- Every 90 days as a baseline cadence
- Immediately after a suspected key compromise
- When an admin with key access leaves the organization

---

## Migrating from v1.0.0

In OpsKnight `v1.0.0`, the encryption key could be stored directly in the `SystemSettings` database table via the System Settings UI. That feature has been removed in `v1.1.0`.

**If you previously set a key via the UI**, here's how to migrate without losing data:

1. Retrieve the key that was stored in the database:

   ```sql
   SELECT "encryptionKey" FROM "SystemSettings" WHERE id = 'default';
   ```

2. Set it as the `ENCRYPTION_KEY` environment variable in your deployment.

3. Redeploy. All existing encrypted data will continue to decrypt correctly — the cryptographic format is unchanged.

> **There is no need to re-encrypt existing data.** The underlying AES-256-CBC envelope encryption format is identical. Only the source of the key has changed (from DB → env var).

---

## Security Considerations

| Concern                  | Recommendation                                                 |
| ------------------------ | -------------------------------------------------------------- |
| Key storage              | Use a secrets manager; never hardcode in source control        |
| Key backup               | Keep at least one encrypted backup of the key in a safe place  |
| Key access               | Restrict who can read `ENCRYPTION_KEY` in your secrets manager |
| Loss of key              | Encrypted data is permanently unrecoverable without the key    |
| Same key in dev and prod | Use distinct keys per environment                              |

---

## FAQ

**Q: What happens if `ENCRYPTION_KEY` is not set in production?**

The application starts normally, but any attempt to save an encrypted secret (SSO client secret, Slack token, etc.) will fail with an error. Existing encrypted data cannot be read. The rest of the application continues to function.

**Q: Can I use a key shorter than 64 hex characters?**

No. The key must be exactly 64 hexadecimal characters (representing 32 bytes / 256 bits). Any other format is rejected at startup.

**Q: What if I lost the key?**

Encrypted data is permanently unrecoverable without the master key. You will need to set a new key and manually re-enter all integration secrets (SSO, Slack, notification providers) through the UI.

**Q: Is data encrypted in transit as well?**

Encryption at rest (this feature) is separate from encryption in transit (TLS/HTTPS). Always run OpsKnight behind HTTPS in production.

**Q: Can I verify that the correct key is configured?**

If your SSO or Slack integrations are functioning correctly, the key is working. You can also attempt to save and load an integration credential — a decryption error in the server logs indicates a key mismatch.

---

## Related Topics

- [OIDC SSO Setup](./oidc-setup) — Single sign-on configuration
- [Configuration Reference](../getting-started/configuration) — All environment variables
- [Authentication](../administration/authentication) — Authentication methods and session management
