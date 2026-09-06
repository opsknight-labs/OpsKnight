---
order: 4
title: Audit Logs
description: Track security events, configuration changes, and user activity for compliance and investigation
---

# Audit Logs

Audit logs provide a comprehensive record of security-relevant events across your OpsKnight organization. They're essential for compliance, security investigations, and understanding who did what and when.


---

## Why Audit Logs Matter

| Without Audit Logs            | With Audit Logs               |
| ----------------------------- | ----------------------------- |
| No accountability for changes | Full attribution              |
| Can't investigate incidents   | Complete event history        |
| Compliance gaps               | Audit-ready records           |
| Security blind spots          | Suspicious activity detection |

---

## Accessing Audit Logs

### Requirements

- **Role**: Admin only
- **Location**: **Insights** → **Audit Logs**

### Navigation

1. Click **Insights** in the sidebar
2. Select **Audit Logs**
3. View the event timeline

---

## Event Categories

OpsKnight logs the following events:

### Authentication & Access

| Event                      | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `LOGIN_SUCCESS`            | Successful user login                            |
| `LOGIN_FAILED`             | Failed login attempt (invalid credentials, etc.) |
| `LOGIN_BLOCKED`            | Login blocked (rate limit or account lock)       |
| `LOGOUT`                   | User logged out                                  |
| `PASSWORD_RESET_REQUESTED` | User requested password reset                    |
| `PASSWORD_RESET_COMPLETED` | User successfully reset password                 |
| `session.revoked_all`      | User revoked all their active sessions           |

### User Management

| Event                   | Description                              |
| ----------------------- | ---------------------------------------- |
| `user.invited`          | New user invited                         |
| `user.invite.resent`    | Invitation email resent                  |
| `user.active`           | User activated account (via invite)      |
| `user.role.updated`     | User role changed (Admin/Responder/User) |
| `user.deactivated`      | User account deactivated                 |
| `user.reactivated`      | User account reactivated                 |
| `user.deleted`          | User account deleted                     |
| `user.password.updated` | User changed their own password          |
| `user.bootstrap`        | Initial admin account created            |

### Team Management

| Event                               | Description                          |
| ----------------------------------- | ------------------------------------ |
| `team.created`                      | New team created                     |
| `team.updated`                      | Team details updated                 |
| `team.deleted`                      | Team deleted                         |
| `team.member.added`                 | Member added to team                 |
| `team.member.removed`               | Member removed from team             |
| `team.member.role.updated`          | Member role changed (Owner/Admin)    |
| `team.member.notifications.updated` | Member notification settings changed |

### Service & Integration

| Event                        | Description                      |
| ---------------------------- | -------------------------------- |
| `service.updated`            | Service details updated          |
| `service.deleted`            | Service deleted                  |
| `integration.created`        | New integration added to service |
| `integration.deleted`        | Integration removed from service |
| `integration.status_updated` | Integration enabled/disabled     |
| `integration.secret_rotated` | Integration secret rotated       |
| `integration.secret_cleared` | Integration secret cleared       |

### Escalation Policies

| Event                               | Description              |
| ----------------------------------- | ------------------------ |
| `escalation_policy.created`         | New policy created       |
| `escalation_policy.updated`         | Policy details updated   |
| `escalation_policy.deleted`         | Policy deleted           |
| `escalation_policy.step_added`      | Escalation step added    |
| `escalation_policy.step_updated`    | Escalation step modified |
| `escalation_policy.step_deleted`    | Escalation step removed  |
| `escalation_policy.step_moved`      | Step moved up/down       |
| `escalation_policy.steps_reordered` | Multiple steps reordered |

### System Configuration

| Event                           | Description                    |
| ------------------------------- | ------------------------------ |
| `oidc.config.updated`           | OIDC/SSO configuration updated |
| `system.encryption_key.updated` | System encryption key updated  |
| `system.encryption_key.rotated` | System encryption key rotated  |

---

## Event Details

Each audit log entry contains:

| Field         | Description                                     |
| ------------- | ----------------------------------------------- |
| **Action**    | The event type (e.g. `user.invited`)            |
| **Actor**     | The user who performed the action               |
| **Target**    | The entity affected (`USER`, `TEAM`, `SERVICE`) |
| **Details**   | Specific metadata (JSON)                        |
| **Timestamp** | When the event occurred                         |

### Example Event

```json
{
  "action": "team.member.added",
  "entityType": "TEAM_MEMBER",
  "entityId": "team_123:user_456",
  "actorId": "user_admin_789",
  "details": {
    "teamId": "team_123",
    "userId": "user_456",
    "role": "MEMBER"
  },
  "createdAt": "2024-01-15T10:30:45Z"
}
```

---

## Viewing Audit Logs

### Event Table

The Audit Log page displays a chronological table of system events:

| Column        | Description                                     |
| ------------- | ----------------------------------------------- |
| **Timestamp** | When the event occurred                         |
| **Actor**     | User or System that performed the action        |
| **Action**    | The type of event (e.g. `user.invited`)         |
| **Entity**    | The target type and ID (e.g. `USER`, `abc-123`) |
| **Details**   | Technical metadata in JSON format               |

The table currently displays the most recent 250 events.

---

## Data Retention

System settings control how long audit logs are kept:

1. Go to **Settings** → **System Settings**
2. Scroll to **Data Retention**
3. Configure **System Logs** (Default: 90 days)

Events older than the retention period are automatically deleted.

---

## Security Monitoring

### Suspicious Activity Detection

OpsKnight flags potentially suspicious events implies you should monitor:

- Consecutive `LOGIN_FAILED` events
- `LOGIN_BLOCKED` events indicating rate limiting
- `session.revoked_all` events

### Active Sessions

Users can view and revoke their own sessions:

1. Go to **Settings** → **Security**
2. View **Active Sessions** table
3. Click **Revoke All** to sign out of all devices

---

## Compliance Support

Audit logs provide an immutable record of all administrative actions, supporting compliance requirements for:

- **SOC 2**: Access control and change management logging
- **GDPR**: Tracking data access and user management
- **HIPAA**: Administrative audit trails

---

## Best Practices

### Regular Review

| Frequency     | Review Focus                   |
| ------------- | ------------------------------ |
| **Daily**     | Failed logins, security events |
| **Weekly**    | Permission changes, new users  |
| **Monthly**   | Configuration changes          |
| **Quarterly** | Full audit, compliance check   |

### Investigation Workflow

When investigating an issue:

1. **Identify timeframe** of suspicious activity
2. **Scroll logs** to relevant period
3. **Identify actors** involved
4. **Trace actions** chronologically
5. **Correlate events** across categories
6. **Take screenshots** for evidence
7. **Document findings**

### Retention Planning

- **Minimum**: Keep logs long enough for incident investigation (90 days)
- **Compliance**: Meet regulatory requirements
- **Storage**: Balance retention with storage costs

### Access Control

- Limit audit log access to admins
- Review who has admin access regularly
- Use SSO with MFA for admin accounts
- Log admin actions for accountability

---

## Troubleshooting

### Missing Events

1. Check that you are looking at the correct timeframe (scroll down)
2. Confirm actor has performed the actions recently
3. Check retention period settings in System Settings
4. Verify you have Admin permissions

---

## Related Topics

- [Authentication](./authentication) — Login and session management
- [Users](../core-concepts/users) — User management
- [Security Overview](../security) — Security best practices
- [Data Retention](./data-retention) — Retention policies
