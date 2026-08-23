---
order: 3
---

# CLI Tool

The OpsKnight CLI is a **recovery and automation tool** for user management.

> **Important**: For normal operations, use the web interface:
>
> - **First admin**: Use the `/setup` page when OpsKnight first starts
> - **Additional users**: Use **Settings → Users → Invite User**
>
> The CLI is primarily for recovery scenarios (e.g., locked out of all admin accounts) or CI/CD automation.

## Usage

```bash
npm run opsknight -- [options]
```

## When to Use the CLI

| Scenario                  | Recommended Method       |
| ------------------------- | ------------------------ |
| First-time setup          | `/setup` page in browser |
| Adding team members       | Invite via UI            |
| Locked out of admin       | **CLI**                  |
| CI/CD user provisioning   | **CLI**                  |
| Password reset (no email) | **CLI** with `--update`  |

## Create a User

```bash
npm run opsknight -- \
  --user "John Doe" \
  --email john@company.com \
  --password SecurePass123! \
  --role admin
```

## Options

| Option       | Description                        | Required |
| ------------ | ---------------------------------- | -------- |
| `--user`     | User's full name                   | ✅       |
| `--email`    | Email address                      | ✅       |
| `--password` | Password                           | ✅       |
| `--role`     | Role: `admin`, `responder`, `user` | ✅       |
| `--update`   | Update existing user               | -        |

## Update a User

```bash
npm run opsknight -- \
  --user "John Doe" \
  --email john@company.com \
  --password NewPassword123! \
  --role responder \
  --update
```

## Docker Usage

```bash
docker exec -it opsknight_app npm run opsknight -- \
  --user "Admin" \
  --email admin@example.com \
  --password SecurePass123! \
  --role admin
```

## Kubernetes Usage

```bash
kubectl exec -it deploy/opsknight -- npm run opsknight -- \
  --user "Admin" \
  --email admin@example.com \
  --password SecurePass123! \
  --role admin
```

## Best Practices

- Use strong passwords.
- Store credentials securely.
- Prefer SSO for production.
