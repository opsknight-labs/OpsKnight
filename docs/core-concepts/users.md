---
order: 7
---

# Users

Manage user access and permissions in OpsKnight.

## Roles

| Role      | Description       | Capabilities                   |
| --------- | ----------------- | ------------------------------ |
| Admin     | Full access       | All permissions                |
| Responder | Incident handling | Manage incidents and schedules |
| User      | Read-only         | View dashboards and incidents  |

## Create Users

### CLI

```bash
npm run opsknight -- \
  --user "John Doe" \
  --email john@company.com \
  --password SecurePass123! \
  --role responder
```

### UI

1. Go to **Users**
2. Click **+ Invite User**
3. Enter email and role

## Deactivate Users

1. Go to **Users**
2. Select the user
3. Click **Deactivate**

Deactivated users cannot log in, but their history remains.

## Best Practices

- Use least-privilege roles.
- Require responders to add phone numbers.
- Review access quarterly.
