# syntax=docker/dockerfile:1

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Make npm installs more resilient in CI/buildx (esp. arm64)
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_NETWORK_TIMEOUT=600000 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

# Install security updates and required packages
RUN apk update && apk upgrade && \
    apk add --no-cache libc6-compat openssl openssl-dev && \
    rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./

# Add build arg to bust cache for migrations (ensures new migrations are always copied)
ARG BUILD_DATE=unknown
RUN echo "Build date: $BUILD_DATE"

COPY prisma ./prisma/

# Install production dependencies including optional dependencies
# Optional dependencies (twilio, @sendgrid/mail, resend, nodemailer, @aws-sdk/client-sns)
# are needed for notification features. npm ci --omit=dev installs optionalDependencies by default.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --legacy-peer-deps --ignore-scripts --no-audit --no-fund && \
    rm -rf /tmp/*

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Make npm installs more resilient in CI/buildx (esp. arm64)
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_NETWORK_TIMEOUT=600000 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

# Install security updates
RUN apk update && apk upgrade && \
    apk add --no-cache libc6-compat openssl openssl-dev && \
    rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./

# Add build arg to bust cache for migrations
ARG BUILD_DATE=unknown
RUN echo "Build date: $BUILD_DATE"

COPY prisma ./prisma/

# Install all dependencies (including dev) - essential for build steps
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund

# Copy application source
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Set a dummy DATABASE_URL for build time only (Prisma requires it for validation)
# This will be overridden by the actual DATABASE_URL at runtime
# checkov:skip=CKV_SECRET_4: This is a dummy DATABASE_URL for build time only
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
ENV DATABASE_URL=$DATABASE_URL

# Build Next.js application with production optimizations
# Pages that need database access are marked as dynamic, so build works without DB
RUN npm run build
# Compile helper scripts for production (where ts-node is not available)
RUN npm run build:scripts

# Stage 3: Production Runner
FROM node:20-alpine AS runner
WORKDIR /app

# Install security updates and required runtime packages
RUN apk update && apk upgrade && \
    apk add --no-cache curl openssl openssl-dev && \
    rm -rf /var/cache/apk/* && \
    rm -rf /tmp/*

# Set environment to production
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_RUNTIME=nodejs

# Create non-root user with specific UID/GID for consistency
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs && \
    mkdir -p /app && \
    chown -R nextjs:nodejs /app

# Copy necessary files from builder
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/package*.json ./
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# Copy base node_modules first
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Then copy Prisma-specific files (must be AFTER base node_modules to avoid being overwritten)
# This ensures Prisma CLI and client are available for migrations
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Set port environment variable
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy entrypoint script
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Health check with improved error handling
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health?mode=readiness', (r) => {let data='';r.on('data',(c)=>data+=c);r.on('end',()=>{const res=JSON.parse(data);process.exit(res.status==='healthy'?0:1)});}).on('error',()=>process.exit(1))"

# Run entrypoint which does: migrate → start app
ENTRYPOINT ["./docker-entrypoint.sh"]

# Link image to repository
LABEL org.opencontainers.image.source="https://github.com/opsknight-labs/OpsKnight"
