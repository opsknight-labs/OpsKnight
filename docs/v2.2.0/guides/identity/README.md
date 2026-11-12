---
title: Identity and single sign-on
order: 1
description: Set up single sign-on, decide who can sign in, give people roles and teams from your identity provider, and provision accounts with SCIM.
type: concept
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-11-04
  evidence:
    - src/components/settings/AuthenticationConsole.tsx
    - src/components/settings/authentication/setup-steps.ts
    - src/lib/auth-control/messages.ts
---

# Identity and single sign-on

OpsKnight connects to one OpenID Connect (OIDC) identity provider such as Microsoft Entra ID,
Google Workspace, Okta, Auth0 or Keycloak. You set it up in **Settings → System → SSO /
Authentication**, in four steps:

| Step                     | What you do                                                                                                                   | Guide                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **1 · Connect provider** | Choose your provider, copy two callback URLs into it, paste the client ID and secret, and save. Saving checks the connection. | [Configure single sign-on](./configure-oidc/)              |
| **2 · Who can sign in**  | Decide whether new people get an account automatically, which email domains are allowed, and approve existing accounts.       | [Link existing accounts](./link-existing-accounts/)        |
| **3 · Roles & teams**    | Optional. Give people a role and teams from their identity provider groups, and try your rules with sample claims.            | [Map groups to roles and teams](./map-roles-and-teams/)    |
| **4 · Test & activate**  | Sign in once yourself, see exactly what will change, and turn single sign-on on.                                              | [Test and turn on single sign-on](./test-and-enforce-sso/) |

For what each role and team role can do, how people request access, emergency access, custom
roles and access reviews, see [Roles, permissions and access requests](./roles-and-access/).

Nothing changes for anyone until the last step. Until then, everyone keeps signing in the way
they do today.

## Choosing how people sign in

- **SSO Optional** — people can use single sign-on or their password. Start here.
- **SSO Required** — everyone must use single sign-on. This needs two
  [emergency recovery identities](./configure-emergency-access/) first, so a provider outage
  can never lock you out.

See [authentication modes](./authentication-modes/) for exactly what each mode allows.

## Provisioning with SCIM

Single sign-on decides who can sign in. [SCIM](./configure-scim/) lets your directory create,
update and deactivate accounts and keep team membership in sync, so people are ready before
their first sign-in and lose access the moment they leave.

## When something goes wrong

Every sign-in problem shows a specific message and a reference ID. Look the message up in
[sign-in problems](../../troubleshooting/login/oidc-access/). If your own test sign-in fails,
see [administrator test failures](../../troubleshooting/login/admin-test-failures/).

## More

- [Migrate the first administrator to SSO](./migrate-admin-to-sso/)
- [Rotate provider credentials](./rotate-oidc-credentials/)
- [Recover from an SSO lockout](./sso-lockout-recovery/)
- [Upgrade from v2.1](./upgrade-existing-sso/)
