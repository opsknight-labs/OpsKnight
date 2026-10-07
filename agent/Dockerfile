ARG OPSKNIGHT_VERSION=2.0.0

FROM node:24.21.0-alpine AS build
ARG OPSKNIGHT_VERSION
WORKDIR /src
RUN npm install --global esbuild@0.28.2
COPY agent ./agent
RUN esbuild agent/src/index.ts --bundle --platform=node --target=node24 --format=esm --packages=external --banner:js='import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);' --outfile=/out/opsknight-agent.mjs \
  && echo -n "${OPSKNIGHT_VERSION}" > /out/VERSION

FROM node:24.21.0-alpine
ARG OPSKNIGHT_VERSION
ENV OPSKNIGHT_AGENT_VERSION=${OPSKNIGHT_VERSION}
RUN apk add --no-cache bash docker-cli podman iproute2 kubectl procps \
  && addgroup -S opsknight-agent && adduser -S -G opsknight-agent opsknight-agent \
  && mkdir -p /var/lib/opsknight-agent /etc/opsknight-agent \
  && chown -R opsknight-agent:opsknight-agent /var/lib/opsknight-agent /etc/opsknight-agent
COPY --from=build /out/opsknight-agent.mjs /usr/local/bin/opsknight-agent.mjs
COPY --from=build /out/VERSION /usr/local/bin/VERSION
COPY agent/policy.container.json /etc/opsknight-agent/policy.json
COPY agent/healthcheck.mjs /usr/local/bin/opsknight-agent-healthcheck.mjs
USER opsknight-agent
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD ["node", "/usr/local/bin/opsknight-agent-healthcheck.mjs"]
ENTRYPOINT ["node", "/usr/local/bin/opsknight-agent.mjs"]
