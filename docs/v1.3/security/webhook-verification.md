---
title: Webhook Authentication & Signature Verification
description: Cryptographic signature verification, constant-time HMAC checks, and anti-replay protection.
version: v1.3
order: 2
---

# Webhook Authentication & Signature Verification

OpsKnight implements a **zero-trust, fail-closed** security model for all inbound and outbound webhook traffic.

---

## 🔒 Inbound Webhook Authentication

Every inbound integration route enforces a mandatory two-stage security boundary before payloads reach business logic:

```mermaid
sequenceDiagram
    autonumber
    actor Provider as Alerting Provider (e.g. Datadog, Zabbix, GitLab)
    participant Middleware as Webhook Ingestion Middleware
    participant Security as Cryptographic Security Layer
    participant Engine as Incident Core Engine

    Provider->>Middleware: POST /api/integrations/:type (Payload + Headers)
    Middleware->>Security: 1. Extract Integration Key (Bearer, Token, x-key, Query)
    Security-->>Middleware: Integration Key Validated (Constant-time check)

    alt Secret Configured
        Middleware->>Security: 2. Verify Cryptographic Signature (HMAC-SHA256, HMAC-SHA1)
        Security-->>Middleware: Signature Validated
    end

    Middleware->>Engine: Process Event & Trigger Escalation
    Engine-->>Provider: HTTP 202 Accepted (dedup_key)
```

---

## 🔑 Key Extraction & Constant-Time Verification

OpsKnight extracts integration keys across standard headers and fallbacks:

1. `Authorization: Bearer <KEY>`
2. `Authorization: Token token=<KEY>` (PagerDuty v2 standard)
3. `x-integration-key: <KEY>` or `x-api-key: <KEY>`
4. `?integrationKey=<KEY>` or `?key=<KEY>`

### Timing-Safe Equality

To prevent timing-based side-channel attacks on secret keys and signatures, OpsKnight employs `crypto.timingSafeEqual`:

```typescript
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Dummy constant-time comparison prevents leaking length
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}
```

---

## 🛡️ Supported Signature Providers

OpsKnight provides built-in cryptographic verifiers for all major webhook protocols:

| Provider | Signature Header | Algorithm | Signature Format |
| :--- | :--- | :--- | :--- |
| **GitHub** | `x-hub-signature-256` | HMAC-SHA256 | `sha256=<hex_digest>` |
| **GitLab** | `x-gitlab-token` | Constant-time string | `<secret_token>` |
| **Sentry** | `sentry-hook-signature` | HMAC-SHA256 | `<hex_digest>` |
| **Slack ChatOps** | `x-slack-signature` | HMAC-SHA256 | `v0=<hex_digest>` (with timestamp) |
| **Grafana** | `x-grafana-signature` | HMAC-SHA256 | `<hex_digest>` |
| **Vercel** | `x-vercel-signature` | HMAC-SHA1 | `<hex_digest>` |
| **Generic Webhooks** | `x-signature` / `x-webhook-signature` | HMAC-SHA256 | `<hex_digest>` |

---

## ⏱️ Outbound Anti-Replay Protection

When OpsKnight sends outbound webhooks (e.g. status page notifications, third-party dispatchers), signatures are bound to the delivery timestamp to prevent replay attacks:

```typescript
const timestamp = Math.floor(Date.now() / 1000).toString();
const signedPayload = `${timestamp}.${payloadString}`;
const hmac = crypto
  .createHmac('sha256', secret)
  .update(signedPayload)
  .digest('hex');

// Sent as:
// X-OpsKnight-Timestamp: 1786973846
// X-OpsKnight-Signature: sha256=abcdef12345...
```

Receivers can verify the signature and reject any requests with timestamps older than 300 seconds.
