# Troubleshooting Guide

This guide covers common issues you may encounter when installing, configuring, or running OpsKnight.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Database Connection Problems](#database-connection-problems)
- [Authentication Failures](#authentication-failures)
- [Notification Delivery Issues](#notification-delivery-issues)
- [Performance Troubleshooting](#performance-troubleshooting)
- [Debug Logging](#debug-logging)

---

## Installation Issues

### npm install fails with permission errors

**Symptoms:**

- `EACCES` permission denied errors
- `EPERM` operation not permitted

**Solutions:**

1. **Don't use sudo with npm.** Instead, fix npm permissions:

   ```bash
   mkdir ~/.npm-global
   npm config set prefix '~/.npm-global'
   echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
   source ~/.bashrc
   ```

2. **Use a Node version manager** like nvm or fnm:
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install 20
   nvm use 20
   ```

### Build fails with "out of memory"

**Symptoms:**

- `JavaScript heap out of memory`
- Build process killed

**Solutions:**

1. **Increase Node.js memory limit:**

   ```bash
   export NODE_OPTIONS="--max-old-space-size=4096"
   npm run build
   ```

2. **Use the standalone build** (recommended for production):
   ```bash
   npm run build
   # This creates .next/standalone with optimized bundle
   ```

### Optional dependencies fail to install

**Symptoms:**

- Warnings about `twilio`, `resend`, or `@aws-sdk/client-sns`
- These are **optional** and won't prevent OpsKnight from running

**Solution:**
Install only the providers you need:

```bash
# For Twilio SMS/WhatsApp
npm install twilio

# For Resend email
npm install resend

# For AWS SNS
npm install @aws-sdk/client-sns

# For SendGrid email
npm install @sendgrid/mail
```

---

## Database Connection Problems

### "Connection refused" or "Connection timed out"

**Symptoms:**

- `ECONNREFUSED` error
- `Connection timed out` after deployment

**Solutions:**

1. **Verify PostgreSQL is running:**

   ```bash
   # Check if PostgreSQL is running
   pg_isready -h localhost -p 5432

   # For Docker
   docker ps | grep postgres
   ```

2. **Check your DATABASE_URL format:**

   ```
   postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
   ```

3. **For cloud databases (Supabase, Neon, etc.):**
   - Enable SSL: Add `?sslmode=require` to the connection string
   - Check firewall rules allow your IP
   - Verify the database is in the same region as your app

### "Prisma Client not initialized"

**Symptoms:**

- `@prisma/client did not initialize yet`
- `PrismaClient is unable to be run in the browser`

**Solutions:**

1. **Regenerate Prisma Client:**

   ```bash
   npx prisma generate
   ```

2. **For production builds:**
   ```bash
   # Include in your build script
   npm run build  # This runs prisma generate automatically
   ```

### Migration errors

**Symptoms:**

- `Migration failed` during deployment
- `P3009: migrate found failed migrations`

**Solutions:**

1. **Check migration status:**

   ```bash
   npx prisma migrate status
   ```

2. **Use the safe migration script:**

   ```bash
   npm run prisma:migrate:safe
   ```

3. **For failed migrations, use auto-recovery:**

   ```bash
   npm run prisma:auto-recover
   ```

4. **Manual recovery (last resort):**
   ```sql
   -- Connect to your database and mark failed migration as applied
   UPDATE "_prisma_migrations"
   SET finished_at = NOW(), applied_steps_count = 1
   WHERE migration_name = 'YYYYMMDDHHMMSS_migration_name'
   AND finished_at IS NULL;
   ```

---

## Authentication Failures

### "Invalid credentials" but credentials are correct

**Symptoms:**

- Login fails with valid email/password
- "Invalid credentials" error

**Solutions:**

1. **Check if the user exists:**

   ```bash
   # Use the OpsKnight CLI
   npm run ops user:list
   ```

2. **Reset the password:**

   ```bash
   npm run ops user:reset-password --email user@example.com
   ```

3. **Verify the encryption key hasn't changed** (see [Encryption Key Issues](#encryption-key-issues))

### Session expires immediately

**Symptoms:**

- Logged out after every page refresh
- "Session expired" error immediately after login

**Solutions:**

1. **Check NEXTAUTH_URL matches your actual URL:**

   ```bash
   # .env
   NEXTAUTH_URL=https://your-actual-domain.com
   ```

2. **Verify cookies are being set:**
   - Open browser DevTools → Application → Cookies
   - Look for `next-auth.session-token` cookie
   - Check if `Secure` flag matches your protocol (HTTPS vs HTTP)

3. **For reverse proxy setups,** ensure headers are forwarded:
   ```nginx
   # nginx example
   proxy_set_header Host $host;
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   proxy_set_header X-Forwarded-Proto $scheme;
   ```

### OIDC/SSO login fails

**Symptoms:**

- "Invalid state" or "Invalid nonce" errors
- Redirect loop during SSO login

**Solutions:**

1. **Verify callback URL is configured correctly:**
   - Callback URL should be: `https://your-domain.com/api/auth/callback/oidc`
   - This must exactly match what's configured in your IdP

2. **Check the OIDC configuration in Settings → Security → SSO**

3. **For Azure AD:** Ensure `email` claim is included in the token

4. **Enable debug logging** (see [Debug Logging](#debug-logging))

---

## Notification Delivery Issues

### Emails not being sent

**Symptoms:**

- No emails received
- "Email provider not configured" warnings in logs

**Solutions:**

1. **Verify email provider is configured:**
   - Go to Settings → System → Email Providers
   - Ensure a provider is enabled and has valid credentials

2. **Check the from email address:**
   - For Resend/SendGrid: Domain must be verified
   - For SMTP: Check your mail server allows this sender

3. **Test email delivery:**
   - Go to Settings → Notifications → Test Email
   - Check logs for delivery errors

### SMS not being delivered

**Symptoms:**

- SMS notifications not received
- "Twilio package not installed" error

**Solutions:**

1. **Install the Twilio package:**

   ```bash
   npm install twilio
   ```

2. **Verify Twilio configuration:**
   - Account SID and Auth Token in Settings → System → Notification Providers
   - From Number must be a valid Twilio phone number
   - For trial accounts: Target number must be verified

3. **Check phone number format:**
   - Must be in E.164 format: `+15551234567`
   - Include country code

### Push notifications not working

**Symptoms:**

- "Push notifications not enabled" error
- Browser doesn't prompt for notification permission

**Solutions:**

1. **Check VAPID keys are configured:**
   - Settings → System → Notification Providers → Web Push
   - Generate new keys if needed:
     ```bash
     npx web-push generate-vapid-keys
     ```

2. **Verify HTTPS:**
   - Push notifications only work over HTTPS
   - Exception: `localhost` for development

3. **Check browser permissions:**
   - Click the lock icon in the URL bar
   - Ensure notifications are "Allowed"

---

## Performance Troubleshooting

### Slow page loads

**Symptoms:**

- Pages take several seconds to load
- Timeout errors

**Solutions:**

1. **Check database query performance:**

   ```bash
   # Enable query logging
   LOG_LEVEL=debug npm start
   ```

2. **Optimize database:**

   ```sql
   -- Check for missing indexes
   SELECT schemaname, tablename, indexname
   FROM pg_indexes
   WHERE schemaname = 'public';

   -- Analyze tables
   ANALYZE;
   ```

3. **Increase connection pool:**
   ```
   DATABASE_URL="...?connection_limit=20"
   ```

### High memory usage

**Symptoms:**

- Server runs out of memory
- OOM killer terminates process

**Solutions:**

1. **For standalone builds,** memory usage should be lower:

   ```bash
   node .next/standalone/server.js
   ```

2. **Set appropriate memory limits:**

   ```bash
   # Docker
   docker run --memory=512m opsknight

   # Node.js
   NODE_OPTIONS="--max-old-space-size=512" node server.js
   ```

3. **Check for memory leaks** using Node.js diagnostics:
   ```bash
   node --inspect .next/standalone/server.js
   # Connect Chrome DevTools to take heap snapshots
   ```

### Cron jobs not running

**Symptoms:**

- Escalations not triggered on schedule
- Scheduled jobs stuck as "pending"

**Solutions:**

1. **Check cron scheduler status:**
   - Go to Settings → System → Background Jobs
   - Verify "Cron Scheduler" shows as "Running"

2. **Enable internal cron:**

   ```bash
   # Default is enabled
   ENABLE_INTERNAL_CRON=true
   ```

3. **Check for lock issues:**

   ```sql
   -- View scheduler state
   SELECT * FROM "CronSchedulerState";

   -- Clear stale lock if needed
   UPDATE "CronSchedulerState"
   SET "lockedBy" = NULL, "lockedAt" = NULL
   WHERE id = 'singleton';
   ```

---

## Debug Logging

### Enable verbose logging

```bash
# Set log level
LOG_LEVEL=debug npm start

# For JSON output (better for log aggregation)
LOG_FORMAT=json npm start
```

### Log levels

| Level   | Description                     |
| ------- | ------------------------------- |
| `error` | Only errors                     |
| `warn`  | Errors and warnings             |
| `info`  | Normal operation logs (default) |
| `debug` | Detailed debugging information  |

### Common log locations

- **Application logs:** stdout/stderr (or configured log destination)
- **Database logs:** PostgreSQL log files
- **Cron scheduler:** Look for `[Cron]` prefix in logs
- **Notifications:** Look for `component: 'sms'`, `component: 'email'`, etc.

### Encryption Key Issues

If you see `CRITICAL: Encryption Key failed canary check`:

1. The encryption key has changed or is invalid
2. Data encrypted with the old key cannot be decrypted

**Recovery steps:**

1. Restore the original `ENCRYPTION_KEY` from backup
2. If key is lost, you'll need to re-enter all encrypted credentials (API keys, etc.)

---

## Getting Help

If you're still stuck:

1. **Search existing issues:** [GitHub Issues](https://github.com/opsknight-labs/opsknight/issues)
2. **Check discussions:** [GitHub Discussions](https://github.com/opsknight-labs/opsknight/discussions)
3. **Open a new issue** with:
   - OpsKnight version
   - Node.js version
   - PostgreSQL version
   - Relevant log output (redact sensitive data!)
   - Steps to reproduce
