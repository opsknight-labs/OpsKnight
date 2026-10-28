/* eslint-disable @typescript-eslint/no-require-imports -- Shared deployment renderer and standalone CLI. */
'use strict';
const assert = require('node:assert/strict');

/** Optional private gateway for PostgreSQL ingestion. TLS may terminate upstream.
 * Admission is bounded before Next middleware buffers bodies. This per-gateway
 * resource bound is separate from authenticated distributed quotas.
 * https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html
 */
function renderIngestionGateway({ upstreams, maxInFlight = 64, port = 8080, bodyIdleSeconds = 5 }) {
  assert.ok(Array.isArray(upstreams) && upstreams.length > 0 && upstreams.length <= 128);
  for (const address of upstreams) {
    assert.match(address, /^[A-Za-z0-9_.-]+:[0-9]{1,5}$/);
    const upstreamPort = Number(address.split(':')[1]);
    assert.ok(upstreamPort >= 1 && upstreamPort <= 65535);
  }
  for (const value of [maxInFlight, port, bodyIdleSeconds]) assert.ok(Number.isInteger(value));
  assert.ok(maxInFlight >= 1 && maxInFlight <= 4096);
  assert.ok(port >= 1024 && port <= 65535);
  assert.ok(bodyIdleSeconds >= 1 && bodyIdleSeconds <= 60);
  return `events { worker_connections 4096; }
http {
  access_log off;
  error_log /dev/stderr crit;
  map "$request_method:$uri" $opsknight_ingestion_key {
    default "";
    "~^POST:/api/(?:events(?:/|$)|integrations(?:/|$))" ingestion;
  }
  limit_conn_zone $opsknight_ingestion_key zone=opsknight_ingestion:1m;
  upstream gateways { ${upstreams.map(address => `server ${address};`).join(' ')} keepalive 64; }
  server {
    listen ${port};
    client_max_body_size 10m;
    limit_conn opsknight_ingestion ${maxInFlight};
    limit_conn_status 503;
    limit_conn_log_level info;
    error_page 503 = @ingestion_overload;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Connection "";
    proxy_next_upstream off;
    proxy_intercept_errors off;
    location ~ ^/api/(?:events(?:/|$)|integrations(?:/|$)) {
      # Built-in request error logs contain full URIs, including query credentials.
      error_log /dev/null crit;
      client_max_body_size 1m;
      client_body_timeout ${bodyIdleSeconds}s;
      proxy_pass http://gateways;
    }
    location / { proxy_pass http://gateways; }
    location @ingestion_overload {
      error_log /dev/null crit;
      default_type application/json;
      add_header Retry-After 5 always;
      return 503 '{"error":"INGESTION_OVERLOADED","message":"Ingestion temporarily unavailable"}';
    }
  }
}
`;
}
module.exports = { renderIngestionGateway };
if (require.main === module) {
  process.stdout.write(
    renderIngestionGateway({
      upstreams: (process.env.OPSKNIGHT_WEB_UPSTREAMS || 'opsknight-web:3000').split(','),
      maxInFlight: Number(process.env.OPSKNIGHT_GATEWAY_MAX_INFLIGHT || 64),
      port: Number(process.env.OPSKNIGHT_GATEWAY_PORT || 8080),
      bodyIdleSeconds: Number(process.env.OPSKNIGHT_GATEWAY_BODY_IDLE_SECONDS || 5),
    })
  );
}
