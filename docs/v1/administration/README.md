---
order: 3
title: Administration
description: Configure notifications, authentication, data retention, and system settings
---

# Administration

This section covers the administrative configuration of OpsKnight, including notification providers, authentication, data retention, custom fields, and audit logging. These settings are typically configured once during setup and reviewed periodically.

---

## Who Should Read This

- **System Administrators** — Setting up OpsKnight for your organization
- **DevOps/Platform Engineers** — Configuring notification channels
- **Security Teams** — Setting up SSO, reviewing audit logs
- **Operations Managers** — Understanding data retention and compliance

---

## Administration Topics

| Topic                              | Description                                 | Why It Matters                 |
| ---------------------------------- | ------------------------------------------- | ------------------------------ |
| [Notifications](./notifications)   | Configure Email, SMS, Push, WhatsApp, Slack | Ensure alerts reach responders |
| [Authentication](./authentication) | Local auth, SSO/OIDC, user management       | Secure access control          |
| [Custom Fields](./custom-fields)   | Add metadata fields to incidents            | Track additional information   |
| [Data Retention](./data-retention) | Configure cleanup policies                  | Manage storage and compliance  |
| [Audit Logs](./audit-logs)         | Track security-relevant events              | Compliance and troubleshooting |

---

## Quick Setup Checklist

When setting up OpsKnight for your organization, complete these administrative tasks:

### 1. Configure Notification Channels

Without notifications, OpsKnight can't alert responders. Set up at least one channel:

| Priority                | Channel | Setup Guide                                                               |
| ----------------------- | ------- | ------------------------------------------------------------------------- |
| **Essential**           | Email   | [SMTP/SendGrid/Resend setup](./notifications#email)                       |
| **Recommended**         | Slack   | [Slack OAuth integration](./integrations/communication/slack-oauth-setup) |
| **For Critical Alerts** | SMS     | [Twilio/AWS SNS setup](./notifications#sms)                               |
| **For Mobile**          | Push    | [FCM/OneSignal setup](./notifications#push)                               |

### 2. Set Up Authentication

Choose your authentication strategy:

| Option              | Best For                 | Setup                               |
| ------------------- | ------------------------ | ----------------------------------- |
| **Local Auth**      | Small teams, quick start | Default, no config needed           |
| **Google SSO**      | Google Workspace orgs    | [OIDC setup](./security/oidc-setup) |
| **Microsoft Entra** | Microsoft 365 orgs       | [OIDC setup](./security/oidc-setup) |
| **Okta/Auth0**      | Enterprise with IdP      | [OIDC setup](./security/oidc-setup) |

### 3. Create Teams and Invite Users

1. **Create teams** to organize responders
2. **Invite users** via email
3. **Assign roles** (User, Responder, Admin)
4. **Add users to teams** with appropriate roles

### 4. Configure Data Retention (Optional)

Set retention policies based on your compliance needs:

- **Incidents**: 2 years (default)
- **Alerts**: 1 year (default)
- **Logs**: 90 days (default)

### 5. Review Audit Logs

Understand what's being tracked:

- Login attempts
- User management changes
- Configuration changes
- Data access events

---

## Accessing Admin Settings

### Via UI

1. Click **Settings** in the sidebar
2. Sections available depend on your role:
   - **Users**: Everyone can access their profile
   - **Teams**: Team admins can manage their teams
   - **System Settings**: Admin role required

### Via API

Admin endpoints require admin API keys:

```bash
# List users (admin only)
curl -H "Authorization: Bearer sk_admin_xxx" \
  https://opsknight.yourco.com/api/users
```

---

## Admin Roles and Permissions

| Role          | Capabilities                                         |
| ------------- | ---------------------------------------------------- |
| **User**      | View incidents, acknowledge, basic profile settings  |
| **Responder** | All User permissions + on-call + incident management |
| **Admin**     | All permissions + system settings + user management  |

### What Admins Can Do

- Configure notification providers (Email, SMS, Push)
- Set up SSO/OIDC integration
- Manage all users (invite, disable, change roles)
- Configure custom fields
- Set data retention policies
- View and export audit logs
- Configure system settings (App URL, encryption)

---

## System Health Monitoring

### Health Check Endpoint

```bash
curl https://opsknight.yourco.com/api/health
```

Response:

```json
{
  "status": "ok",
  "database": "connected",
  "version": "1.0.0"
}
```

### What to Monitor

| Component         | What to Check                        |
| ----------------- | ------------------------------------ |
| **Database**      | Connection status, query performance |
| **Job Queue**     | Pending jobs, failed jobs            |
| **Notifications** | Delivery success rate                |
| **Integrations**  | Webhook success rate                 |

---

## Security Considerations

### Sensitive Data

OpsKnight stores sensitive configuration that should be protected:

| Data             | Storage  | Protection        |
| ---------------- | -------- | ----------------- |
| API keys         | Database | Encrypted at rest |
| OAuth tokens     | Database | Encrypted at rest |
| SMTP credentials | Database | Encrypted at rest |
| User passwords   | Database | Bcrypt hashed     |

### Access Control

- Use **SSO** when possible for centralized identity management
- Enable **MFA** at your identity provider
- Review **audit logs** regularly
- **Rotate API keys** periodically
- Use **least privilege** — only grant Admin role when necessary

### Data Privacy

- Configure **data retention** to meet compliance requirements
- Incidents and alerts are deleted after retention period
- **Audit logs** have separate retention (typically longer)
- Consider **GDPR/CCPA** requirements for user data

---

## Troubleshooting Common Issues

### Notifications Not Sending

1. Check provider configuration in Settings → Notifications
2. Verify credentials are correct
3. Test with "Send Test" button
4. Check system logs for errors
5. Verify user has notifications enabled

### Users Can't Log In

1. Check user status (ACTIVE, DISABLED, INVITED)
2. For SSO: Verify OIDC configuration
3. For local auth: Check password requirements
4. Review audit logs for failed login attempts
5. Check rate limiting (lockout after failures)

### Data Not Appearing

1. Check data retention settings
2. Verify database connectivity
3. Check if data was deleted by retention policy
4. Review system logs for errors

---

## Related Topics

- [Security](./security) — Encryption, SSO, access control
- [Deployment](./deployment) — Production setup
- [Architecture](./architecture) — System internals
