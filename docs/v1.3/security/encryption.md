---
order: 3
title: Encryption
description: Configure, protect, and recover the key that encrypts supported stored credentials
---

# Encryption

OpsKnight encrypts selected integration and notification-provider credentials at rest. Configure `ENCRYPTION_KEY` before storing real secrets. Treat this key as production-critical: losing it can make existing encrypted values unreadable.

## Configure the master key

Generate a 32-byte key encoded as 64 hexadecimal characters:

```bash
openssl rand -hex 32
```

Set the generated value in your deployment's secret store, then inject it into the application:

```dotenv
# .env (do not commit this file)
ENCRYPTION_KEY=replace-with-a-64-character-hex-key
```

For Docker Compose, load the value from the environment or an untracked `.env` file. For Kubernetes, store it in a Kubernetes Secret or an external secret manager and reference it from the container environment.

| Environment | Missing or invalid key behavior                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Development | OpsKnight uses a fixed development-only fallback and logs a warning.                                        |
| Production  | Credential encryption and decryption are unavailable. Do not configure integrations until the key is valid. |

The key must be exactly 64 hexadecimal characters. Use a different key for each environment.

## What OpsKnight protects

OpsKnight uses AES-256-CBC envelope encryption for supported stored credentials. The current protected values include:

- OIDC client secrets.
- Slack bot tokens, signing secrets, and Slack OAuth client secrets.
- Jira API tokens and webhook secrets.
- Notification-provider credential fields, including SMTP passwords, Twilio credentials, AWS SNS/SES credentials, Resend and SendGrid API keys, and Web Push private VAPID keys.

API keys are different: OpsKnight displays the raw `ok_…` key only when it is created, then stores a one-way scrypt hash. API keys cannot be recovered from the database and are not encrypted with `ENCRYPTION_KEY`.

Provider configuration supports an `enc:` marker for encrypted values. If the application cannot obtain a valid encryption key, do not assume a configuration save is safe: inspect server logs and correct the key configuration before entering credentials.

## Back up and recover

Back up the exact production key in an access-controlled recovery system separate from the application database. Limit read access to the deployment identity and a small emergency recovery group.

If the key is lost:

1. Existing encrypted credentials cannot be decrypted.
2. Create and securely store a new key.
3. Deploy it to every application instance.
4. Re-enter affected OIDC, Slack, Jira, and notification-provider credentials.
5. Test each integration after saving it.

Do not copy a development key into production, place keys in repository files, browser-visible configuration, incident tickets, or ordinary application logs.

## Rotate with a maintenance plan

Key rotation is not a single configuration change. A newly configured key cannot decrypt credentials written with the old key unless the old key remains available during a supported migration path.

OpsKnight has compatibility handling for a limited set of legacy system-stored values. It is not a complete, general-purpose key-rotation service for every encrypted record or provider configuration. Before rotating a production key:

1. Take a tested database backup and record the current key's secure recovery location.
2. Rehearse the change in an environment with representative encrypted credentials.
3. Identify every configured integration and notification provider.
4. Plan how to validate or re-enter each credential if it cannot be migrated.
5. Roll out the new key consistently to all replicas; mixed keys can produce intermittent failures.

For a suspected compromise, revoke or rotate the upstream provider credentials as well as the OpsKnight key. Re-encrypting local storage alone does not invalidate a leaked Slack token, SMTP password, or provider API key.

## Operational checks

After initial setup, restart an application instance and test one non-production credential flow. After a deployment or rotation, test each configured integration and inspect server logs for decryption errors.

Use TLS at the reverse proxy or load balancer for data in transit. Encryption at rest does not replace HTTPS, access control, database backups, or secrets-manager permissions.

## Related topics

- [OIDC SSO setup](./oidc-setup)
- [Authentication](../administration/authentication)
- [Configuration reference](../getting-started/configuration)
- [Docker deployment](../deployment/docker)
