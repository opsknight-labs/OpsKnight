import http from "k6/http";
import { check } from "k6";
import { Rate } from "k6/metrics";

const fanoutErrors = new Rate("fanout_errors");

export const options = {
  scenarios: {
    fanout_burst: {
      executor: "constant-arrival-rate",
      rate: 3000,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 300,
      maxVUs: 500,
    },
  },
  thresholds: {
    http_req_duration: ["p(99)<2000"],
    fanout_errors:     ["rate<0.02"],
  },
};

export default function () {
  const res = http.get("http://127.0.0.1:3300/api/status", { timeout: "5s" });
  const ok = check(res, {
    "200 OK": (r) => r.status === 200,
    "payload valid": (r) => r.body && r.body.length > 10,
  });
  fanoutErrors.add(!ok);
}
