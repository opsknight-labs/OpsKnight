# OpsKnight PgBouncer Image with CA certificates bundle
FROM ghcr.io/icoretech/pgbouncer-docker:1.26.0@sha256:f6537e614011f3d95349847fdd47f1b3a96be86eab99015b5b5918f732884a75

USER root
RUN apk add --no-cache ca-certificates
USER postgres
