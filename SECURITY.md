# Security policy

## Report a vulnerability privately

Do not open a public issue containing an undisclosed vulnerability, exploit, customer data or credentials.

Use GitHub's [private vulnerability reporting form](https://github.com/opsknight-labs/OpsKnight/security/advisories/new) when available. If the repository does not offer that form, contact [help@opsknight.com](mailto:help@opsknight.com), the project's published contact, with the subject `Private security report`. Ask for a secure exchange channel before sending sensitive material. This address is a fallback contact, not a dedicated 24/7 security desk.

Include:

- affected version, image digest or commit, deployment mode and relevant configuration;
- affected component or endpoint, prerequisites and minimal reproduction steps;
- expected versus observed behavior, likely impact and any evidence of exploitation;
- sanitized proof of concept and suggested severity/CVSS vector, if known;
- a private reply address and whether you would like public credit.

Test only systems you own or have permission to assess. Minimize personal data in reports. Do not send passwords, live tokens or production database dumps.

## Response process

Maintainers aim to acknowledge reports within **two business days** and provide an initial assessment within **five business days**. These are best-effort handling targets, not guaranteed service levels or statutory reporting periods. Active exploitation and critical impact receive immediate escalation when identified. If no acknowledgement arrives, follow up on the same private channel.

The process is: acknowledge, validate, classify severity, develop and test a fix, release, coordinate disclosure, then close with retained evidence. The [response plan](docs/security/vulnerability-response.md) defines ownership, triage and escalation. We use CVSS-informed Critical, High, Medium and Low severity, adjusted for deployment exposure and observed exploitation. Patch dates depend on impact, validation and safe release readiness; we do not promise an unverified fix deadline.

Coordinate public disclosure with maintainers. Credit is included only with the reporter's consent. Public advisories describe affected/fixed versions, impact, workarounds and upgrade guidance without exposing private customer information.

## Support lifecycle

Security updates target the latest major version. See [supported versions and EOL](docs/security/supported-versions.md) for maintenance scope and release-specific limitations. No fixed multi-year support period or per-minor backport guarantee is established by this policy.

## Deployment checklist

- Use a supported release and track [security advisories](https://github.com/opsknight-labs/OpsKnight/security/advisories).
- Terminate HTTPS at a trusted ingress; restrict database and administrative network access.
- Configure strong `NEXTAUTH_SECRET` and encryption keys outside source control, stored separately from database backups.
- New protected secret writes use authenticated AES-256-GCM envelopes. Legacy CBC reads remain supported. API keys are hashed; general incident text is not field-encrypted. See [encryption and key overlap](docs/v1.5/security/encryption.md). Never remove an old key until all dependent ciphertext and required backups can be recovered.
- Configure OIDC and enforce MFA at the identity provider. OpsKnight has no native server-verified second factor. SCIM supports Users, not Groups; deprovisioning is not full personal-data erasure.
- Apply least privilege and review administrator and responder access.
- Session cookies are HttpOnly, use SameSite=Lax, and are Secure for HTTPS deployments. JWT sessions use token-version revocation and configured lifetime limits. Verify effective behavior in your deployment.
- Configure backups, protected storage, retention and restoration drills using the [backup procedure](docs/v1.5/deployment/backup-restore.md). Retain matching encryption keys and deployment configuration.
- Review audit records and preserve required evidence externally. Database audit rows are subject to access and retention controls; they are not immutable/WORM storage.
- Review third-party integrations, notification recipients and data transfers. Set retention according to your processing needs and applicable requirements.

## Browser security headers

The current defaults in [next.config.ts](next.config.ts) include HSTS `max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive permissions policy. Reverse proxies may change effective responses; verify them on the deployed application. An HSTS header does not prove acceptance into a browser preload list.

CSP currently permits `unsafe-inline` and `unsafe-eval` for scripts. It also restricts frames, objects, form actions and base URIs. This is a compatibility policy, not a strict nonce-based CSP. See the configuration for the complete policy. The legacy X-XSS-Protection header is not a substitute for output escaping or CSP.

## Security and compliance evidence

- [Control catalogue and framework mappings](docs/compliance/README.md)
- [Evidence collection](docs/compliance/evidence/README.md)
- [Release security checklist](docs/security/release-security-checklist.md)
- [Advisory template](docs/security/security-advisory-template.md)

These materials describe capabilities and responsibilities. They do not assert CRA/GDPR compliance, a SOC 2 attestation, or ISO certification.
