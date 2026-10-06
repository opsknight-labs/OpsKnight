FROM node:24-alpine AS build
WORKDIR /src
RUN npm install --global esbuild@0.28.2
COPY agent ./agent
RUN esbuild agent/src/index.ts --bundle --platform=node --target=node24 --format=esm --packages=external --banner:js='import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);' --outfile=/out/opsknight-agent.mjs

FROM node:24-alpine
RUN apk add --no-cache bash docker-cli podman iproute2 kubectl procps \
  && addgroup -S opsknight-agent && adduser -S -G opsknight-agent opsknight-agent \
  && mkdir -p /var/lib/opsknight-agent /etc/opsknight-agent \
  && chown -R opsknight-agent:opsknight-agent /var/lib/opsknight-agent /etc/opsknight-agent
COPY --from=build /out/opsknight-agent.mjs /usr/local/bin/opsknight-agent.mjs
COPY agent/policy.container.json /etc/opsknight-agent/policy.json
COPY agent/healthcheck.mjs /usr/local/bin/opsknight-agent-healthcheck.mjs
USER opsknight-agent
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD ["node", "/usr/local/bin/opsknight-agent-healthcheck.mjs"]
ENTRYPOINT ["node", "/usr/local/bin/opsknight-agent.mjs"]
