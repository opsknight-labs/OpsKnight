---
order: 13
---

# Authentication and Security

OpsKnight implements defense-in-depth to protect authentication flows, sessions, and sensitive data.

## Security Controls

| Risk              | Protection                     | Notes                                 |
| ----------------- | ------------------------------ | ------------------------------------- |
| Brute force       | Rate limiting + lockouts       | Progressive lockouts after failures   |
| User enumeration  | Uniform responses              | Same response for valid/invalid users |
| Session hijacking | Token versioning               | Invalidates old sessions immediately  |
| Timing attacks    | Constant-time responses        | Prevents side-channel leaks           |
| Privilege abuse   | Audit logging + admin controls | Sensitive actions logged              |

## Rate Limiting

Login attempts are tracked by email + IP.

| Lockout Count | Duration   |
| ------------- | ---------- |
| 1             | 1 minute   |
| 2             | 5 minutes  |
| 3             | 15 minutes |
| 4+            | 1 hour     |

## Password Policy

- Minimum 10 characters
- Uppercase and lowercase letters
- At least one number
- Special characters recommended

## Sessions

| Mode        | Duration |
| ----------- | -------- |
| Standard    | 7 days   |
| Remember Me | 30 days  |

Sessions can be revoked by admins or users.

## Audit Logging

Authentication events are recorded in audit logs for compliance and investigation.

## Related Docs

- [Security](../security/)
- [Authentication](../administration/authentication.md)
