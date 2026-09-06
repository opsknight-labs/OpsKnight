---
order: 1
---

# Docker Deployment

Deploy OpsKnight with Docker Compose. This is the fastest way to run the platform locally and is suitable for small production environments.

## Prerequisites

- Docker Engine 20+
- Docker Compose 2+
- PostgreSQL (included in Compose by default)

## Quick Start

```bash
# Clone repository
git clone https://github.com/opsknight-labs/opsknight.git
cd opsknight

# Configure
cp env.example .env

# Start services
docker compose up -d
```

Open `http://localhost:3000` — you'll be directed to `/setup` to create your admin account.

## Required Configuration

Set the core variables in `.env`:

```bash
DATABASE_URL=postgresql://opsknight:password@postgres:5432/opsknight_db
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=your-32-char-secret
```

> **Important:** `NEXTAUTH_URL` must match the exact base URL users will access.

Generate a secret:

```bash
openssl rand -base64 32
```

## Docker Compose Files

| File                      | Purpose                     |
| ------------------------- | --------------------------- |
| `docker-compose.yml`      | Standard deployment         |
| `docker-compose.dev.yml`  | Development with hot reload |
| `docker-compose.prod.yml` | Production optimizations    |

## Production Checklist

1. Use a strong database password.
2. Set `NEXTAUTH_URL` to your public HTTPS domain.
3. Configure SMTP/SMS providers in **Settings → Notifications**.
4. Put a reverse proxy in front of the app for TLS termination.

### Example nginx Reverse Proxy

```nginx
server {
    listen 443 ssl;
    server_name ops.yourcompany.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
```

## Updating

```bash
# Pull latest changes
git pull

# Update images
docker compose pull

# Restart containers
docker compose up -d
```

## Backups

```bash
# Database backup
docker exec opsknight_postgres pg_dump -U opsknight opsknight_db > backup.sql

# Restore
cat backup.sql | docker exec -i opsknight_postgres psql -U opsknight opsknight_db
```

## Troubleshooting

### View Logs

```bash
docker compose logs -f app
docker compose logs -f postgres
```

### Reset Database

```bash
docker compose down -v
docker compose up -d
```

### Health Check

- Confirm `http://localhost:3000` loads.
- Log in with the admin user.
- Create a test service to validate DB writes.
