FROM node:20-alpine AS build
WORKDIR /src
RUN npm install --global esbuild@0.28.2
COPY agent ./agent
RUN esbuild agent/src/index.ts --bundle --platform=node --target=node20 --format=esm --packages=external --banner:js='import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);' --outfile=/out/opsknight-agent.mjs

FROM node:20-alpine
RUN apk add --no-cache docker-cli iproute2 kubectl procps \
  && addgroup -S opsknight-agent && adduser -S -G opsknight-agent opsknight-agent \
  && mkdir -p /var/lib/opsknight-agent /etc/opsknight-agent \
  && chown -R opsknight-agent:opsknight-agent /var/lib/opsknight-agent /etc/opsknight-agent
COPY --from=build /out/opsknight-agent.mjs /usr/local/bin/opsknight-agent.mjs
COPY agent/policy.container.json /etc/opsknight-agent/policy.json
USER opsknight-agent
ENTRYPOINT ["node", "/usr/local/bin/opsknight-agent.mjs"]
