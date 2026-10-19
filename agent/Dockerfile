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
RUN apk add --no-cache bash docker-cli podman iproute2 kubectl procps tini fuse-overlayfs \
  && addgroup -S opsknight-agent && adduser -S -G opsknight-agent opsknight-agent \
  && echo "opsknight-agent:100000:65536" >> /etc/subuid \
  && echo "opsknight-agent:100000:65536" >> /etc/subgid \
  && mkdir -p /var/lib/opsknight-agent /etc/opsknight-agent /etc/containers \
    /home/opsknight-agent/.config/containers /home/opsknight-agent/.local/share/containers \
  && printf '[storage]\ndriver = "vfs"\nrunroot = "/tmp/containers-run"\ngraphroot = "/var/lib/opsknight-agent/containers/storage"\n' > /etc/containers/storage.conf \
  && printf '[engine]\ncgroup_manager = "cgroupfs"\nevents_logger = "file"\n' > /etc/containers/containers.conf \
  && chown -R opsknight-agent:opsknight-agent /var/lib/opsknight-agent /etc/opsknight-agent /home/opsknight-agent
COPY --from=build /out/opsknight-agent.mjs /usr/local/bin/opsknight-agent.mjs
COPY --from=build /out/VERSION /usr/local/bin/VERSION
COPY agent/policy.container.json /etc/opsknight-agent/policy.json
COPY agent/healthcheck.mjs /usr/local/bin/opsknight-agent-healthcheck.mjs
USER opsknight-agent
ENV OPSKNIGHT_AGENT_HEALTH_FILE=/tmp/opsknight-agent-health.json

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD ["node", "/usr/local/bin/opsknight-agent-healthcheck.mjs", "liveness"]
ENTRYPOINT ["/sbin/tini", "--", "node", "/usr/local/bin/opsknight-agent.mjs"]
