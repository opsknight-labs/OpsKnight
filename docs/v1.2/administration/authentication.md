---
order: 1
title: Authentication
description: Configure local authentication, SSO/OIDC, session management, and security settings
---

# Authentication

Authentication controls how users prove their identity to access OpsKnight. This guide covers local authentication, SSO integration, session management, and security best practices.


---

## Authentication Methods

OpsKnight supports two authentication methods:

| Method       | Best For                            | Features                          |
| ------------ | ----------------------------------- | --------------------------------- |
| **Local**    | Small teams, development, testing   | Email/password, simple setup      |
| **SSO/OIDC** | Enterprise, compliance requirements | Centralized identity, MFA via IdP |

You can enable both methods simultaneously, allowing users to choose their preferred login method.

---

## Local Authentication

Local authentication uses email and password credentials stored in OpsKnight.

### How It Works

```
User enters email + password
        ↓
OpsKnight validates credentials
        ↓
Session created, user logged in
```

### First-Time Setup

When OpsKnight starts with no users, the first admin must be created via the `/setup` page:

1. Navigate to your OpsKnight URL (e.g., `https://ops.yourcompany.com`)
2. You'll be automatically redirected to `/setup`
3. Enter your details:
   - **Name**: Your display name
   - **Email**: Your email address
4. Click **Create Admin Account**
5. **Save the generated password immediately** — it's shown only once


> **Security Note**: The `/setup` page is only accessible when no users exist. After the first admin is created, this page becomes unavailable.

### Adding Users via Invitation

The recommended way to add users after initial setup:

1. Go to **Settings** → **Users**
2. Click **Invite User**
3. Enter user details:
   - **Email**: User's email address
   - **Name**: Display name
   - **Role**: ADMIN, RESPONDER, or USER
4. Click **Send Invitation**

**Invitation Flow**:

```
Admin sends invite
        ↓
User receives email with link
        ↓
User clicks link (valid 7 days)
        ↓
User sets their password
        ↓
Account activated
```

### Password Requirements

| Requirement    | Value                                         |
| -------------- | --------------------------------------------- |
| Minimum length | 8 characters                                  |
| Complexity     | Recommended: mix of letters, numbers, symbols |
| Expiration     | None (configurable via policy)                |

### Password Reset

**User-initiated reset**:

1. Go to login page
2. Click **Forgot Password**
3. Enter email address
4. Check email for reset link
5. Click link and set new password

Reset links expire after **1 hour**.

**Admin-initiated reset**:

1. Go to **Settings** → **Users**
2. Click on the user
3. Click **Reset Password**
4. User receives email with reset link

---

## SSO / OIDC Authentication

Single Sign-On (SSO) via OIDC is recommended for production environments.

### Benefits of SSO

| Benefit                  | Description                           |
| ------------------------ | ------------------------------------- |
| **Centralized identity** | Manage users in your IdP              |
| **MFA support**          | Leverage IdP's MFA capabilities       |
| **Auto-provisioning**    | Create users on first login           |
| **Role mapping**         | Sync roles from IdP groups            |
| **Compliance**           | Meet enterprise security requirements |

### Supported Identity Providers

| Provider               | Tested | Notes                         |
| ---------------------- | :----: | ----------------------------- |
| **Google Workspace**   |   ✅   | OAuth consent screen required |
| **Microsoft Entra ID** |   ✅   | Formerly Azure AD             |
| **Okta**               |   ✅   | OIDC Web App integration      |
| **Auth0**              |   ✅   | Regular Web Application       |
| **Keycloak**           |   ✅   | OpenID Connect client         |
| **OneLogin**           |   ✅   | OIDC connector                |
| **Any OIDC Provider**  |   ✅   | Standard OIDC compliance      |

### SSO Configuration

1. Go to **Settings** → **System Settings** → **Single Sign-On (OIDC)**
2. Enable SSO toggle
3. Configure provider settings:

| Field             | Description     | Example                             |
| ----------------- | --------------- | ----------------------------------- |
| **Issuer URL**    | OIDC issuer URL | `https://accounts.google.com`       |
| **Client ID**     | From your IdP   | `abc123.apps.googleusercontent.com` |
| **Client Secret** | From your IdP   | `GOCSPX-xxxxx`                      |
| **Scopes**        | OIDC scopes     | `openid email profile` (default)    |

4. Save configuration
5. Test with **Test SSO** button

### Callback URL

Configure this URL in your identity provider:

```
https://YOUR_OPSKNIGHT_URL/api/auth/callback/oidc
```

### Provider-Specific Guides

See [OIDC SSO Setup](../security/oidc-setup) for detailed guides on:

- Google Workspace
- Microsoft Entra ID (Azure AD)
- Okta
- Auth0
- Keycloak

---

## Role Mapping

Map identity provider claims to OpsKnight roles automatically.

### How Role Mapping Works

```
User logs in via SSO
        ↓
IdP returns claims (groups, roles, etc.)
        ↓
OpsKnight matches claims against rules
        ↓
User assigned matching role
```

### Configuring Role Mapping

1. Go to **Settings** → **System Settings** → **Single Sign-On (OIDC)**
2. Scroll to **Role Mapping**
3. Add mapping rules as JSON:

```json
[
  { "claim": "groups", "value": "admins", "role": "ADMIN" },
  { "claim": "groups", "value": "oncall-team", "role": "RESPONDER" },
  { "claim": "department", "value": "engineering", "role": "RESPONDER" }
]
```

### Mapping Rule Format

| Field   | Description                                     |
| ------- | ----------------------------------------------- |
| `claim` | The IdP claim to check                          |
| `value` | The value to match                              |
| `role`  | OpsKnight role: `ADMIN`, `RESPONDER`, or `USER` |

### Role Mapping Priority

Rules are evaluated in order. First match wins:

1. If user matches "admins" group → ADMIN
2. Else if user matches "oncall-team" → RESPONDER
3. Else → Default role (USER)

### Default Role

Users who don't match any rule receive the default role:

- **Default**: `USER`
- **Configurable**: Set in SSO settings

---

## Profile Mapping

Sync user profile fields from identity provider claims.

### Supported Fields

| OpsKnight Field | Common Claim Names           |
| --------------- | ---------------------------- |
| **Name**        | `name`, `preferred_username` |
| **Email**       | `email`                      |
| **Department**  | `department`                 |
| **Job Title**   | `jobTitle`, `title`          |
| **Avatar URL**  | `picture`, `avatar_url`      |

### Configuring Profile Mapping

1. Go to **Settings** → **Security** → **Single Sign-On**
2. Scroll to **Profile Mapping**
3. Map claim names to fields:

| Field      | Claim Name   |
| ---------- | ------------ |
| Department | `department` |
| Job Title  | `title`      |
| Avatar URL | `picture`    |

### Sync Behavior

- Profile fields update on each login
- Empty claims don't overwrite existing values
- Manual edits preserved if claim is empty

---

## User Auto-Provisioning

Automatically create users on first SSO login.

### Enabling Auto-Provisioning

1. Go to **Settings** → **System Settings** → **Single Sign-On (OIDC)**
2. Enable **Auto-provision users**

### Provisioning Behavior

| Setting                 | Enabled                       | Disabled       |
| ----------------------- | ----------------------------- | -------------- |
| New user SSO login      | Account created automatically | Login denied   |
| Existing user SSO login | Login succeeds                | Login succeeds |
| Default role            | Applied from role mapping     | N/A            |

### Domain Restrictions

Limit auto-provisioning to specific email domains:

1. Go to SSO settings
2. Set **Allowed Domains**: `yourcompany.com, subsidiary.com`
3. Only users with matching email domains can auto-provision

---

## Session Management

Control how user sessions are handled.

### Session Duration

| Setting             | Default | Description              |
| ------------------- | ------- | ------------------------ |
| **Session timeout** | 30 days | Maximum session duration |
| **Idle timeout**    | 7 days  | Timeout after inactivity |

### Viewing Active Sessions

Users can view their sessions:

1. Go to **Profile** → **Security**
2. Scroll to **Active Sessions**
3. See all logged-in devices:
   - Device/browser type
   - IP address
   - Last activity
   - Location (approximate)

### Ending Sessions

**End specific session**:

1. Find session in list
2. Click **Revoke**

**End all sessions**:

1. Click **Revoke All Sessions**
2. Confirm action
3. You'll be logged out everywhere

**Admin force logout**:
Admins can end all sessions for any user:

1. Go to **Settings** → **Users**
2. Click on user
3. Click **Revoke All Sessions**

### Session Security

| Feature            | Description                          |
| ------------------ | ------------------------------------ |
| **Secure cookies** | HTTPS-only in production             |
| **HTTP-only**      | Not accessible via JavaScript        |
| **SameSite**       | Protection against CSRF              |
| **Rotation**       | Session rotated on privilege changes |

---

## Security Settings

### Password Policy

Configure password requirements:

| Setting               | Options                           |
| --------------------- | --------------------------------- |
| **Minimum length**    | 8-128 characters                  |
| **Require uppercase** | Yes/No                            |
| **Require numbers**   | Yes/No                            |
| **Require symbols**   | Yes/No                            |
| **Password history**  | Prevent reuse of last N passwords |

### Login Security

| Setting                  | Description                          |
| ------------------------ | ------------------------------------ |
| **Failed login lockout** | Lock account after N failed attempts |
| **Lockout duration**     | Minutes until auto-unlock            |
| **CAPTCHA**              | Show CAPTCHA after N failures        |

---

## Environment Variables

Authentication-related environment variables:

| Variable          | Required | Description                                 |
| ----------------- | :------: | ------------------------------------------- |
| `NEXTAUTH_SECRET` |   Yes    | Secret for signing tokens                   |
| `NEXTAUTH_URL`    |   Yes    | Base URL for callbacks                      |
| `ENCRYPTION_KEY`  |   Yes    | Encryption for secrets (OIDC client secret) |

### Generating Secrets

```bash
# Generate NEXTAUTH_SECRET
openssl rand -base64 32

# Generate ENCRYPTION_KEY (32 bytes for AES-256)
openssl rand -hex 32
```

> **Security**: Never commit these values to version control.

---

## Hybrid Authentication

Using both local and SSO authentication simultaneously.

### Configuration

1. Set up local authentication (always available)
2. Configure SSO as described above
3. Both options appear on login page

### Login Page Behavior

```
┌─────────────────────────────┐
│        OpsKnight Login       │
├─────────────────────────────┤
│  [Sign in with SSO]          │
│                              │
│  ─────── or ───────          │
│                              │
│  Email: [_____________]      │
│  Password: [_____________]   │
│  [Sign In]                   │
└─────────────────────────────┘
```

### Use Cases

| Scenario                       | Method |
| ------------------------------ | ------ |
| Regular employees              | SSO    |
| Contractors without IdP access | Local  |
| Emergency admin access         | Local  |
| Development/testing            | Local  |

---

## Troubleshooting

### Can't Log In (Local)

1. Verify email is correct
2. Check account status (not DISABLED)
3. Try password reset
4. Check for account lockout
5. Contact admin

### SSO Not Working

1. Verify SSO is enabled
2. Check issuer URL is correct
3. Verify client ID/secret
4. Check callback URL in IdP
5. Test with **Test SSO** button
6. Check browser console for errors

### SSO Button Not Showing

1. Verify SSO is enabled in settings
2. Check `ENCRYPTION_KEY` is configured
3. Ensure configuration was saved successfully

### Role Mapping Not Working

1. Check claim names match exactly
2. Verify IdP sends the expected claims
3. Check role mapping JSON syntax
4. Test with IdP's token debugger

### Session Issues

1. Clear browser cookies
2. Try incognito/private window
3. Check session hasn't expired
4. Verify HTTPS is working

---

## Best Practices

### For Local Auth

- Use strong, unique passwords

- Regular access reviews
- Prompt password resets for departures

### For SSO

- Use SSO for all regular access
- Keep local admin as emergency backup
- Configure role mapping
- Enable auto-provisioning with domain restrictions
- Review SSO logs regularly

### General Security

- Use HTTPS in production
- Protect `NEXTAUTH_SECRET` and `ENCRYPTION_KEY`
- Regular security audits
- Monitor failed login attempts
- Document authentication procedures

---

## Related Topics

- [OIDC SSO Setup](../security/oidc-setup) — Provider-specific guides
- [Users](../core-concepts/users) — User management
- [Audit Logs](./audit-logs) — Authentication event logging
- [Security Overview](../security) — Security best practices
