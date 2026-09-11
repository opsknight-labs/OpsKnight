import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");

export const options = {
  scenarios: {
    status_readers: {
      executor: "ramping-vus",
      startVUs: 50,
      stages: [
        { target: 300, duration: "15s" },
        { target: 300, duration: "30s" },
        { target: 0,   duration: "15s" },
      ],
    },
    health_checkers: {
      executor: "constant-vus",
      vus: 20,
      duration: "60s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<600"],
    errors:            ["rate<0.01"],
  },
};

const STATUS_URL = "http://127.0.0.1:3300/api/status";
const HEALTH_URL = "http://127.0.0.1:3300/api/health";

export default function () {
  const isHealthCheck = __VU <= 20;
  const res = http.get(isHealthCheck ? HEALTH_URL : STATUS_URL, { timeout: "3s" });
  const ok = check(res, { "2xx": (r) => r.status >= 200 && r.status < 300 });
  errorRate.add(!ok);
  sleep(0.02);
}
