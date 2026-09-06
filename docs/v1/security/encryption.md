---
order: 2
---

# Encryption System User Guide

OpsKnight encrypts sensitive secrets (SSO client secrets, Slack tokens, API keys) using a zero-trust approach.

## Overview

- Secrets are encrypted before being stored.
- Encryption keys must be backed up securely.
- Rotation re-encrypts data with a new key.

## First-Time Setup

When you first access **System Settings**, the Encryption Key will be unconfigured.

1. Click **Generate** to create a secure 32-byte (64 char) hex key.
2. Copy the key and store it in a password manager.
3. Confirm you have saved the key.
4. Click **Save Encryption Key**.

> **Important:** The system will refuse to save if you do not confirm backup.

## Key Rotation

Rotate keys on a regular schedule (e.g., every 90 days):

1. Click **Replace Key**.
2. Generate or paste the new key.
3. Ensure **Safe Key Rotation** is enabled.
4. Click **Save Encryption Key**.

### What Happens During Rotation

1. Decrypt data with the current key.
2. Re-encrypt data with the new key.
3. Update the verification canary.

### Resilient Recovery (Fallback Key)

If you ever find that a corrupted secret from a previous rotation is causing your current rotation to fail, you can now input an **Old Key (Fallback)** during the rotation process. The system will automatically attempt to decrypt broken secrets with the fallback key and seamlessly upgrade them to the active key.

> **Note:** OpsKnight uses **Envelope Encryption (V2)**. This means the Master Key encrypts a unique Data Encryption Key (DEK) for every secret, rather than encrypting the secret directly. This ensures extremely fast and scalable key rotations. Legacy secrets are automatically upgraded to V2 upon rotation.

## Emergency Recovery

If the system enters **Emergency Recovery Mode**, the stored key does not match encrypted data.

1. Retrieve the original key from your password manager.
2. Paste it into the input field.
3. Click **Save Encryption Key**.

If the key matches, the system unlocks immediately.

## FAQ

**Q: What if I lost my key?**
A: Lost keys mean encrypted data cannot be recovered. You must set a new key and re-enter secrets.

**Q: Can I use `process.env.ENCRYPTION_KEY`?**
A: Yes, but it is a fallback. The key saved in System Settings takes priority.

**Q: Can I rotate without the current key?**
A: No. Rotation requires access to the current key to decrypt existing secrets.
