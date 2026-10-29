import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
const latency   = new Trend("latency_ms", true);

export const options = {
  scenarios: {
    ramp_to_5k: {
      executor: "ramping-arrival-rate",
      startRate: 500,
      timeUnit: "1s",
      preAllocatedVUs: 300,
      maxVUs: 500,
      stages: [
        { target: 2000, duration: "10s" },
        { target: 5000, duration: "10s" },
        { target: 5000, duration: "30s" },
        { target: 0,    duration: "10s" },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<800", "p(99)<1500"],
    errors:            ["rate<0.01"],
  },
};

export default function () {
  const res = http.get("http://127.0.0.1:3300/api/status", {
    headers: { "Accept": "application/json" },
    timeout: "3s",
  });
  const ok = check(res, {
    "status 200": (r) => r.status === 200,
    "has OPERATIONAL": (r) => r.body && r.body.includes("OPERATIONAL"),
  });
  errorRate.add(!ok);
  latency.add(res.timings.duration);
}
