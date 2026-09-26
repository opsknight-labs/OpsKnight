# OpsKnight PgBouncer Image with CA certificates bundle
FROM ghcr.io/icoretech/pgbouncer-docker:1.26.0@sha256:f6537e614011f3d95349847fdd47f1b3a96be86eab99015b5b5918f732884a75

USER root
RUN apk add --no-cache ca-certificates
USER postgres

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD /usr/bin/pg_isready -h 127.0.0.1 -p 6432 || exit 1
