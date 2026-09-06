---
order: 1
title: OIDC SSO Setup
description: Configure OIDC Single Sign-On for common identity providers
---

# OIDC Single Sign-On (SSO) Setup

Configure OIDC SSO in OpsKnight for common identity providers.

---

## Prerequisites

- OpsKnight admin access
- An IdP OIDC app registration created
- A stable base URL for OpsKnight (used for redirect/callback)
- `ENCRYPTION_KEY` configured (required to store client secrets)

---

## Callback URL

Configure this callback URL in your identity provider:

```
https://YOUR_OPSKNIGHT_URL/api/auth/callback/oidc
```

Replace `YOUR_OPSKNIGHT_URL` with your OpsKnight instance URL.

---

## Configuration Fields

| Field               | Required | Description                           |
| ------------------- | :------: | ------------------------------------- |
| **Issuer URL**      |   Yes    | The OIDC issuer URL for your provider |
| **Client ID**       |   Yes    | From your IdP app                     |
| **Client Secret**   |   Yes    | From your IdP app (stored encrypted)  |
| **Custom Scopes**   |    No    | Additional scopes beyond default      |
| **Auto-provision**  |    No    | Create users on first login           |
| **Allowed Domains** |    No    | Email domain allowlist                |
| **Role Mapping**    |    No    | Map IdP claims to roles               |
| **Profile Mapping** |    No    | Map IdP claims to user fields         |
| **Provider Label**  |    No    | Custom text for SSO button            |

**Default Scopes**: `openid email profile`

---

## OpsKnight Setup Steps

1. Go to **Settings** → **System Settings** → **Single Sign-On (OIDC)**
2. Enable SSO
3. Enter Issuer URL, Client ID, Client Secret
4. Configure optional settings:
   - Custom scopes
   - Allowed domains
   - Auto-provision
   - Role mapping
   - Profile mapping
5. Save
6. Test with the SSO button on the login page

---

## Supported Providers

OpsKnight auto-detects provider type from the issuer URL:

| Provider      | Detection                             |
| ------------- | ------------------------------------- |
| **Google**    | `accounts.google.com` in issuer       |
| **Microsoft** | `login.microsoftonline.com` in issuer |
| **Okta**      | `okta` in issuer                      |
| **Auth0**     | `auth0` in issuer                     |
| **Custom**    | All other issuers                     |

---

## Provider Guides

### Google Workspace

1. Create an OAuth app in Google Cloud Console
2. Configure OAuth consent screen
3. Create OAuth client credentials (Web application)
4. **Authorized redirect URI**: `https://YOUR_OPSKNIGHT_URL/api/auth/callback/oidc`
5. **Issuer URL**: `https://accounts.google.com`
6. **Scopes**: `openid email profile` (default)

**Profile mapping claims**:

- `avatarUrl`: `picture`
- `department`: Not provided by Google
- `jobTitle`: Not provided by Google

### Microsoft Entra ID (Azure AD)

1. Register an app in Azure Entra ID
2. Add a Web platform redirect URI: `https://YOUR_OPSKNIGHT_URL/api/auth/callback/oidc`
3. Create a client secret
4. **Issuer URL**: `https://login.microsoftonline.com/YOUR_TENANT_ID/v2.0`
5. **Scopes**: `openid email profile` (default)
6. Optional: Add email and profile claims if not present

**Profile mapping claims**:

- `department`: `department`
- `jobTitle`: `jobTitle`
- `avatarUrl`: `picture`

### Okta

1. Create an OIDC Web App integration
2. **Sign-in redirect URI**: `https://YOUR_OPSKNIGHT_URL/api/auth/callback/oidc`
3. **Issuer URL**: `https://YOUR_OKTA_DOMAIN/oauth2/default`
4. **Scopes**: `openid email profile` (default)

**Profile mapping claims**:

- `department`: `department`
- `jobTitle`: `title`
- `avatarUrl`: `picture`

### Auth0

1. Create a Regular Web Application
2. **Allowed Callback URLs**: `https://YOUR_OPSKNIGHT_URL/api/auth/callback/oidc`
3. **Issuer URL**: `https://YOUR_AUTH0_DOMAIN`
4. **Scopes**: `openid email profile` (default)

**Profile mapping claims**:

- `department`: Use custom claim, e.g., `https://example.com/department`
- `jobTitle`: Use custom claim, e.g., `https://example.com/title`
- `avatarUrl`: `picture`

### Keycloak

1. Create a Realm and Client (OpenID Connect)
2. Client Access Type: Confidential
3. **Valid Redirect URIs**: `https://YOUR_OPSKNIGHT_URL/api/auth/callback/oidc`
4. **Issuer URL**: `https://YOUR_KEYCLOAK_HOST/realms/YOUR_REALM`
5. **Scopes**: `openid email profile` (default)

**Profile mapping claims**:

- `department`: `department`
- `jobTitle`: `jobTitle`
- `avatarUrl`: `picture`

---

## Role Mapping

Map IdP claims to OpsKnight roles automatically.

### Format

JSON array of rules:

```json
[
  { "claim": "groups", "value": "admins", "role": "ADMIN" },
  { "claim": "groups", "value": "oncall-team", "role": "RESPONDER" },
  { "claim": "department", "value": "engineering", "role": "RESPONDER" }
]
```

### Rule Fields

| Field   | Description                                     |
| ------- | ----------------------------------------------- |
| `claim` | The IdP claim name to check                     |
| `value` | The value to match                              |
| `role`  | OpsKnight role: `ADMIN`, `RESPONDER`, or `USER` |

### Evaluation

- Rules are evaluated in order
- First match wins
- Users not matching any rule get the default role (`USER`)

---

## Profile Mapping

Sync user profile fields from IdP claims.

### Supported Fields

| OpsKnight Field | Description         |
| --------------- | ------------------- |
| `department`    | User's department   |
| `jobTitle`      | User's job title    |
| `avatarUrl`     | Profile picture URL |

### Format

JSON object mapping OpsKnight fields to IdP claim names:

```json
{
  "department": "department",
  "jobTitle": "title",
  "avatarUrl": "picture"
}
```

### Behavior

- Profile fields update on each login
- Empty claims don't overwrite existing values

---

## Domain Restrictions

Limit which email domains can use SSO:

1. In SSO settings, add **Allowed Domains**
2. Enter domains (comma-separated): `example.com, subsidiary.com`
3. Only users with matching email domains can sign in

If empty, all email domains are allowed.

---

## Auto-Provisioning

**Enabled**: Users are created automatically on first SSO login.

**Disabled**: Only pre-existing users can sign in via SSO.

When enabled:

- New users get the role from role mapping (or default `USER`)
- Profile fields populated from claims
- Email domain must match allowed domains (if configured)

---

## Troubleshooting

### SSO Button Not Showing

1. Verify SSO is enabled in settings
2. Check `ENCRYPTION_KEY` environment variable is set
3. Verify client secret can be decrypted

### Validation Fails

1. Confirm issuer URL uses HTTPS
2. Verify OIDC discovery document is reachable: `{issuer}/.well-known/openid-configuration`
3. Check client ID and secret are correct

### Access Denied

1. Check allowed domains configuration
2. Verify auto-provision is enabled (for new users)
3. Ensure IdP sends the email claim

### Profile Fields Not Syncing

1. Confirm claim names in profile mapping match IdP claims
2. Verify IdP includes the claims in the token
3. Check IdP token/claims debugger

### Missing Email Claim

Ensure your IdP is configured to include the `email` claim in tokens. Some providers require explicit configuration.

---

## Related Topics

- [Authentication](../administration/authentication) — All authentication methods
- [Users](../core-concepts/users) — User management
- [Security Overview](.) — Security best practices
