# OpsKnight PgBouncer Image with CA certificates bundle and dynamic entrypoint
FROM ghcr.io/icoretech/pgbouncer-docker:1.26.1@sha256:c6696e27b0af0b7897eb191bcb4edf295e790a9411cb1f67d3a2d0b7ac06e962

USER root
RUN apk add --no-cache ca-certificates
COPY --chmod=755 entrypoint.sh /docker-entrypoint.sh
USER postgres

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD /usr/bin/pg_isready -h 127.0.0.1 -p 6432 || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD []
