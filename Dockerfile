# disabled: syntax=docker/dockerfile:1

# Shared, digest-pinned OS packages prevent independently drifting package levels
# and duplicate repository fetches in the dependency, builder and runtime stages.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS base
COPY scripts/docker/install-alpine-packages.sh /usr/local/bin/opsknight-install-alpine-packages
RUN sh /usr/local/bin/opsknight-install-alpine-packages libc6-compat openssl openssl-dev curl && \
    mkdir -p /usr/local/share/opsknight && \
    apk info -vv > /usr/local/share/opsknight/alpine-packages.txt

# Stage 1: Dependencies
FROM base AS deps
WORKDIR /app

# Make npm installs more resilient in CI/buildx (esp. arm64)
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_NETWORK_TIMEOUT=600000 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

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
FROM base AS builder
WORKDIR /app

# Make npm installs more resilient in CI/buildx (esp. arm64)
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_NETWORK_TIMEOUT=600000 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

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

# Embed the source location that corresponds to this build. Official CI passes an
# immutable commit URL. Downstream modified builds should provide their own URL.
ARG SOURCE_CODE_URL="https://github.com/opsknight-labs/OpsKnight"
ENV NEXT_PUBLIC_SOURCE_CODE_URL=$SOURCE_CODE_URL

# Build Next.js application with production optimizations
# Pages that need database access are marked as dynamic, so build works without DB
ARG BUILD_NODE_MAX_OLD_SPACE_SIZE=4096
ENV NODE_OPTIONS="--max-old-space-size=${BUILD_NODE_MAX_OLD_SPACE_SIZE}"
ARG SKIP_BUILD_TYPECHECK=false
ENV SKIP_BUILD_TYPECHECK=${SKIP_BUILD_TYPECHECK}
RUN npm run build
# Compile helper scripts for production (where ts-node is not available)
RUN npm run build:scripts

# Stage 3: Production Runner
FROM base AS runner
WORKDIR /app

# Set environment to production
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_RUNTIME=nodejs

ARG SOURCE_CODE_URL="https://github.com/opsknight-labs/OpsKnight"
ARG BUILD_REVISION=unknown
ENV NEXT_PUBLIC_SOURCE_CODE_URL=$SOURCE_CODE_URL

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

# Ship the legal files with the runtime artifact so image recipients can inspect
# the current license and the preserved terms for historically incorporated material.
COPY --from=builder --chown=nextjs:nodejs /app/LICENSE ./LICENSE
COPY --from=builder --chown=nextjs:nodejs /app/LICENSE-TRANSITION.md ./LICENSE-TRANSITION.md
COPY --from=builder --chown=nextjs:nodejs /app/TRADEMARKS.md ./TRADEMARKS.md
COPY --from=builder --chown=nextjs:nodejs /app/LICENSES ./LICENSES

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
    CMD node -e "require('http').get('http://localhost:3000/api/health?mode=readiness', (r) => {let data='';r.on('data',(c)=>data+=c);r.on('end',()=>{const res=JSON.parse(data);process.exit(res.status!=='unhealthy'&&r.statusCode<400?0:1)});}).on('error',()=>process.exit(1))"

# Run entrypoint which does: migrate → start app
ENTRYPOINT ["./docker-entrypoint.sh"]

# Link image to repository and declare the license of images built from this line.
LABEL org.opencontainers.image.source="https://github.com/opsknight-labs/OpsKnight" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.revision=$BUILD_REVISION
