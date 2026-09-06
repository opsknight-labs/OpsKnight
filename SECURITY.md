# Security Policy

## Supported Versions

We only provide security updates for the latest major version of OpsKnight.

| Version | Supported |
| ------- | --------- |
| 1.x.x   | ✅ Yes    |
| < 1.0.0 | ❌ No     |

## Reporting a Vulnerability

**Please do not open GitHub issues for security vulnerabilities.**

If you discover a security vulnerability within OpsKnight, please send an e-mail to the maintainers. All security vulnerabilities will be promptly addressed.

Please include the following in your report:

- Type of issue (e.g., SQL injection, XSS, RCE)
- Location of the vulnerability (URL or file/line number)
- Step-by-step instructions to reproduce the issue
- Potential impact

## Our Process

1. **Acknowledgment**: We will acknowledge receipt of your report within 48 hours.
2. **Investigation**: We will investigate the issue and determine its severity.
3. **Fix**: We will develop a fix and test it thoroughly.
4. **Disclosure**: We will release a new version with the fix and provide credit to the reporter (if desired).

## Security Best Practices for Users

OpsKnight comes with several security features that should be configured correctly for production use:

- **SSO/OIDC**: Highly recommended for enterprise environments.
- **RBAC**: Ensure users have the minimum necessary permissions.
- **Encryption**: Sensitive data (API keys, secrets) is encrypted in the database.
- **Audit Logs**: Regularly review audit logs for suspicious activity.

---

## Production Deployment Checklist

Before deploying OpsKnight to production, ensure you have addressed all items in this security checklist.

### Environment Variable Security

- [ ] **NEXTAUTH_SECRET**: Generate a strong, unique secret (minimum 32 characters)
  ```bash
  openssl rand -base64 32
  ```
- [ ] **ENCRYPTION_KEY**: Generate a 256-bit (64 hex characters) encryption key
  ```bash
  openssl rand -hex 32
  ```
- [ ] Store secrets in a secure secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
- [ ] Never commit `.env` files to version control
- [ ] Use separate secrets for each environment (dev, staging, production)
- [ ] Rotate secrets regularly (at least annually, or immediately if compromised)

### Encryption Key Management

- [ ] Generate a unique `ENCRYPTION_KEY` for production
- [ ] Store the encryption key separately from the database backup
- [ ] Document key rotation procedures (see below)
- [ ] Keep a secure backup of the encryption key (loss means data cannot be decrypted)
- [ ] Monitor for encryption key validation failures in logs

**Key Rotation Procedure:**

1. Generate a new encryption key
2. Update the `ENCRYPTION_KEY` environment variable
3. Run the key rotation migration to re-encrypt existing data
4. Verify all encrypted data is accessible
5. Securely delete the old key after confirming success

### Database Security

- [ ] **Use TLS/SSL**: Ensure `DATABASE_URL` includes `?sslmode=require` or `?sslmode=verify-full`
  ```
  postgresql://user:pass@host:5432/db?sslmode=verify-full
  ```
- [ ] **Connection Limits**: Configure connection pooling appropriately
  ```
  DATABASE_URL="...?connection_limit=10&pool_timeout=30"
  ```
- [ ] Use a dedicated database user with minimal required permissions
- [ ] Enable database audit logging
- [ ] Configure automatic backups with encryption at rest
- [ ] Restrict database network access (VPC, security groups, firewall rules)
- [ ] Regularly update PostgreSQL to the latest security patches

### Network Security

- [ ] **HTTPS Only**: Deploy behind a reverse proxy with TLS 1.2+ (nginx, Caddy, etc.)
- [ ] **HSTS**: Enable HTTP Strict Transport Security (included in default headers)
- [ ] **Firewall**: Restrict inbound traffic to ports 80 and 443 only
- [ ] **Rate Limiting**: Configure rate limits appropriate for your scale
- [ ] **CORS**: Set `CORS_ALLOWED_ORIGINS` to only trusted domains
- [ ] **Private Network**: Keep database and internal services on a private network
- [ ] Consider using a WAF (Web Application Firewall) for additional protection

### Session & Authentication Hardening

- [ ] **Session Timeout**: Configure appropriate session duration
- [ ] **MFA**: Enable multi-factor authentication for admin accounts
- [ ] **SSO/OIDC**: Use enterprise identity providers when possible
- [ ] **Password Policy**: Enforce strong password requirements
- [ ] **Account Lockout**: Enable account lockout after failed login attempts
- [ ] **Secure Cookies**: Ensure cookies are `HttpOnly`, `Secure`, and `SameSite=Strict`

### Secret Rotation Procedures

Regular secret rotation limits the impact of potential compromises:

| Secret                  | Rotation Frequency        | Procedure                                   |
| ----------------------- | ------------------------- | ------------------------------------------- |
| NEXTAUTH_SECRET         | Annually or on compromise | Update env var, users will need to re-login |
| ENCRYPTION_KEY          | Annually or on compromise | Run migration to re-encrypt data            |
| Database Password       | Quarterly                 | Update in secrets manager and DATABASE_URL  |
| API Keys (Twilio, etc.) | Annually                  | Update in provider settings, then env/DB    |
| VAPID Keys              | When compromised          | Regenerate and update push subscriptions    |

### Backup & Disaster Recovery

- [ ] Configure automated daily database backups
- [ ] Store backups in a separate region/availability zone
- [ ] Encrypt backups at rest
- [ ] Test backup restoration regularly (at least quarterly)
- [ ] Document and test disaster recovery procedures
- [ ] Set up backup monitoring and alerting
- [ ] Maintain backup retention policy (e.g., 30 days daily, 12 months monthly)

### Audit Log Review Practices

- [ ] Enable comprehensive audit logging
- [ ] Review audit logs weekly for suspicious activity
- [ ] Set up alerts for security-relevant events:
  - Failed login attempts
  - Permission changes
  - Admin actions
  - API key creation/deletion
  - Bulk data exports
- [ ] Retain audit logs for compliance requirements (typically 1-7 years)
- [ ] Forward logs to a SIEM for centralized monitoring

### Application Security

- [ ] Keep OpsKnight updated to the latest version
- [ ] Run `npm audit` regularly and address vulnerabilities
- [ ] Review and minimize enabled features/integrations
- [ ] Configure Content Security Policy (CSP) appropriately
- [ ] Enable security headers (X-Frame-Options, X-Content-Type-Options, etc.)
- [ ] Review third-party integrations and their permissions

### Monitoring & Alerting

- [ ] Set up health check monitoring
- [ ] Configure alerts for:
  - Application errors
  - Database connectivity issues
  - High error rates
  - Unusual traffic patterns
  - Certificate expiration
- [ ] Consider integrating Sentry or similar for error tracking
- [ ] Monitor for security advisories in dependencies

---

## Security Headers

OpsKnight includes the following security headers by default:

| Header                    | Value                                        | Purpose                       |
| ------------------------- | -------------------------------------------- | ----------------------------- |
| Strict-Transport-Security | max-age=63072000; includeSubDomains; preload | Forces HTTPS                  |
| X-Frame-Options           | DENY                                         | Prevents clickjacking         |
| X-Content-Type-Options    | nosniff                                      | Prevents MIME sniffing        |
| X-XSS-Protection          | 1; mode=block                                | Legacy XSS protection         |
| Referrer-Policy           | strict-origin-when-cross-origin              | Controls referrer information |
| Permissions-Policy        | camera=(), microphone=(), geolocation=()     | Restricts browser features    |
| Content-Security-Policy   | (see below)                                  | Controls resource loading     |

### Content Security Policy

The default CSP is configured for Next.js compatibility:

```
default-src 'self';
script-src 'self' 'unsafe-eval' 'unsafe-inline';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src 'self' data: https:;
font-src 'self' data: https://fonts.gstatic.com;
connect-src 'self';
frame-ancestors 'none';
manifest-src 'self';
```

**Note**: `'unsafe-eval'` is required by Next.js in development mode. In production, consider using nonce-based CSP if your security requirements are stricter.

---

Thank you for helping keep OpsKnight secure!
