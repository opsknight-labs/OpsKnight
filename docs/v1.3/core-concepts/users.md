---
order: 7
title: Users
description: Manage user accounts, roles, permissions, and notification preferences
---

# Users

Users are the people who interact with OpsKnight — from responders handling incidents to administrators managing the platform. This guide covers user management, roles, permissions, and personal settings.

![Users management](/users-page.png)

---

## Why User Management Matters

| Without Proper User Management | With Proper User Management |
| ------------------------------ | --------------------------- |
| Everyone has full access       | Role-based access control   |
| No accountability              | Clear audit trail           |
| Alert fatigue for all          | Targeted notifications      |
| Manual onboarding              | Streamlined invite flow     |

---

## User Roles

OpsKnight has three user roles with different permission levels:

| Role          | Description                    | Best For                            |
| ------------- | ------------------------------ | ----------------------------------- |
| **ADMIN**     | Full platform access           | Platform administrators, team leads |
| **RESPONDER** | Incident handling capabilities | On-call engineers, SREs             |
| **USER**      | Read-only access               | Stakeholders, managers              |

### Role Permissions Matrix

| Permission                     | Admin | Responder | User |
| ------------------------------ | :---: | :-------: | :--: |
| **View Dashboard**             |  ✅   |    ✅     |  ✅  |
| **View Incidents**             |  ✅   |    ✅     |  ✅  |
| **View Services**              |  ✅   |    ✅     |  ✅  |
| **Acknowledge Incidents**      |  ✅   |    ✅     |  ❌  |
| **Resolve Incidents**          |  ✅   |    ✅     |  ❌  |
| **Reassign Incidents**         |  ✅   |    ✅     |  ❌  |
| **Add Notes to Incidents**     |  ✅   |    ✅     |  ❌  |
| **Create Incidents**           |  ✅   |    ✅     |  ❌  |
| **Manage Schedules**           |  ✅   |    ✅     |  ❌  |
| **Create Overrides**           |  ✅   |    ✅     |  ❌  |
| **Create Services**            |  ✅   |    ❌     |  ❌  |
| **Edit Services**              |  ✅   |    ❌     |  ❌  |
| **Delete Services**            |  ✅   |    ❌     |  ❌  |
| **Manage Teams**               |  ✅   |    ❌     |  ❌  |
| **Manage Escalation Policies** |  ✅   |    ❌     |  ❌  |
| **Manage Integrations**        |  ✅   |    ❌     |  ❌  |
| **Invite Users**               |  ✅   |    ❌     |  ❌  |
| **Manage User Roles**          |  ✅   |    ❌     |  ❌  |
| **System Settings**            |  ✅   |    ❌     |  ❌  |
| **View Analytics**             |  ✅   |    ✅     |  ✅  |
| **Export Data**                |  ✅   |    ✅     |  ❌  |

---

## User Statuses

Users move through different statuses in their lifecycle:

| Status       | Description                         | Can Login |
| ------------ | ----------------------------------- | :-------: |
| **INVITED**  | Invitation sent, pending acceptance |    ❌     |
| **ACTIVE**   | Account active and functional       |    ✅     |
| **DISABLED** | Account deactivated                 |    ❌     |

### Status Flow

```
INVITED ──(accept invite)──► ACTIVE ──(deactivate)──► DISABLED
                                ▲                         │
                                └────(reactivate)─────────┘
```

---

## Adding Users

### First Admin Account (Initial Setup)

When OpsKnight starts with no users:

1. Navigate to `/setup` in your browser
2. Enter admin details:
   - **Email**: Your email address
   - **Name**: Your display name
3. Click **Create Admin**
4. **Save the generated password immediately** — it's shown only once
5. Log in with your credentials

> **Important**: The `/setup` page is only accessible when no users exist in the system.

### Inviting Users (Standard Method)

The recommended way to add users:

1. Go to **Settings** → **Users**
2. Click **Invite User**
3. Fill in the invitation form:

| Field     | Required | Description               |
| --------- | :------: | ------------------------- |
| **Email** |   Yes    | User's email address      |
| **Name**  |   Yes    | Display name              |
| **Role**  |   Yes    | ADMIN, RESPONDER, or USER |

4. Click **Send Invitation**

<!-- placeholder:invite-user-form -->
<!-- Add: Screenshot of the invite user modal -->

### Invitation Process

1. **Invitation sent** — User receives email with invite link
2. **Link expires** — Invitations valid for **7 days**
3. **User accepts** — Clicks link, sets password
4. **Account active** — User can log in immediately

### Resending Invitations

If an invitation expires or user didn't receive it:

1. Find user in the Users list (status: INVITED)
2. Click the user row
3. Click **Resend Invitation**
4. New invitation email sent

---

## User Profile

Each user has a profile with personal information and preferences.

### Profile Fields

| Field        | Description                | Editable By |
| ------------ | -------------------------- | ----------- |
| **Email**    | Login identifier           | Admin only  |
| **Name**     | Display name               | User, Admin |
| **Phone**    | Phone number for SMS       | User, Admin |
| **Timezone** | User's local timezone      | User, Admin |
| **Avatar**   | Profile picture (Gravatar) | Automatic   |
| **Role**     | Permission level           | Admin only  |
| **Status**   | Account status             | Admin only  |

### Viewing Your Profile

1. Click your avatar in the top-right
2. Select **Profile**
3. View and edit your information

### Editing User Profiles (Admin)

1. Go to **Settings** → **Users**
2. Click on a user
3. Edit fields as needed
4. Click **Save**

---

## Contact Methods

Users can configure contact methods for notifications.

### Email

- **Primary email** — Used for login and notifications
- **Verified automatically** — Via invitation process

### Phone Number

For SMS and WhatsApp notifications:

1. Go to **Settings** → **Profile & Preferences**
2. Scroll to **Notification Preferences**
3. Enter your phone number
4. Click **Save Changes**

> **Note**: Phone verification is handled during the notification setup process.

---

## Notification Preferences

Each user controls how they receive notifications.

### Accessing Preferences

1. Go to **Settings** → **Profile & Preferences**
2. Scroll to **Notification Preferences**
3. Toggle channels on/off:
   - **Email**
   - **SMS**
   - **Push**
   - **WhatsApp**

### Digest Settings

Control notification frequency:

1. Go to **Settings** → **Profile & Preferences**
2. Scroll to **General Preferences**
3. Adjust **Incident Digest** level:
   - **HIGH** (Default)
   - **ALL**
   - **NONE**

---

## Security Settings

### Changing Password

1. Go to **Settings** → **Profile & Preferences**
2. Scroll to **Security** section
3. Enter current and new password
4. Click **Update Password**

### Session Management

Manage active sessions across devices:

1. Go to **Settings** → **Profile & Preferences**
2. Scroll to **Security** section
3. View **Active Sessions** list
4. Click **Revoke** to end a specific session
5. Click **Revoke All Others** to secure your account

> **Note**: Revoking a session immediately logs that device out.

---

## API Tokens

Generate personal API tokens for automation.

1. Go to **Settings** → **Profile & Preferences**
2. Click **API Tokens** (if available)

_Note: API Token management is currently restricted to Administrators._

---

## Deactivating Users

When someone leaves or no longer needs access:

1. Go to **Settings** → **Users**
2. Find the user
3. Click **Deactivate**
4. Confirm user will no longer be able to log in

---

## Troubleshooting

### Can't Log In

1. Check email/password are correct
2. Verify account is ACTIVE
3. Contact admin to reset password if needed

### Not Receiving Notifications

1. Check **Notification Preferences** in your Profile
2. Verify **Incident Digest** is not set to NONE
3. check Spam folder for emails

---

## Related Topics

- [Teams](./teams) — Team membership and roles
- [Schedules](./schedules) — On-call rotation management
- [Notifications](../administration/notifications) — Notification channel configuration

---

## Related Topics

- [Teams](./teams) — Team membership and roles
- [Schedules](./schedules) — On-call rotation management
- [Notifications](../administration/notifications) — Notification channel configuration
- [Authentication](../administration/authentication) — SSO and security settings
