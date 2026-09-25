# OpsKnight PgBouncer Image with CA certificates bundle
ARG BASE_IMAGE=ghcr.io/icoretech/pgbouncer-docker:1.26.0@sha256:f6537e614011f3d95349847fdd47f1b3a96be86eab99015b5b5918f732884a75
FROM ${BASE_IMAGE}

USER root
RUN apk add --no-cache ca-certificates
USER postgres

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD /usr/bin/psql -h 127.0.0.1 -p 6432 -U postgres -d pgbouncer -c "SHOW POOLS" || exit 1
