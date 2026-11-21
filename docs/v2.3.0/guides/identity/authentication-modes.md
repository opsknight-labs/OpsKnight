---
title: Authentication modes
description: What Password Only, SSO Optional and SSO Required allow, what each needs, and what happens to existing sessions when you change mode.
type: concept
product_area: identity
audience: [administrator, operator]
reader:
  status: READER_COMPLETE
  task: Choose and change how people sign in.
keywords: [SSO required, SSO optional, password only, enforce SSO, authentication policy]
verification:
  level: source
  verified_at: 2026-11-04
  evidence:
    - src/lib/authentication-policy-evaluator.ts
    - src/lib/auth-control/oidc-revisions.ts
    - src/components/settings/authentication/AuthenticationPolicyWorkspace.tsx
    - src/lib/auth-control/messages.ts
---

# Authentication modes

| Mode | Passwords | Single sign-on | Needs |
| --- | --- | --- | --- |
| **Password Only** | Yes | No | Nothing. New installations start here. |
| **SSO Optional** | Yes | Yes | A passing [test of your own sign-in](./test-and-enforce-sso/). |
| **SSO Required** | No (except [emergency recovery](./configure-emergency-access/)) | Yes | A passing test **and** two emergency recovery identities, each signed in with in the last 90 days. |

Start with **SSO Optional**. Move to **SSO Required** once people have signed in with SSO and you
have set up emergency recovery.

## What changes when you switch

- **To SSO Required**: password sign-in, password changes, password resets and password invites
  stop working. Existing password sessions end; people see *"Your organization changed how you
  sign in"* and sign in again with SSO. Invites become SSO-only automatically.
- **Turning on a new provider configuration**: everyone signed in with SSO signs in again and
  sees *"Single sign-on settings were updated"*.
- **Back to SSO Optional**: open **4 · Test & activate → Change to Password Only or SSO
  Optional**. Choosing Password Only needs your current password.

Every change is audited and alerts administrators.

## Security changes need a recent sign-in

Changing these settings needs an administrator sign-in from the last two hours. The console
warns you 30 minutes ahead and offers **Sign in again**. Emergency recovery sessions need a
fresh credential within five minutes.

## If your identity provider is down

An outage never turns passwords back on by itself. Use
[emergency access](./configure-emergency-access/) to repair the provider while staying on SSO
Required, or follow [SSO lockout recovery](./sso-lockout-recovery/) to restore password access
deliberately.

## Installations upgraded from older versions

Older environment settings are imported once. Later environment changes do not override the
policy you set in the console. An imported emergency password only opens the restricted
recovery console at `/recovery`; retire it after setting up two emergency recovery identities.
