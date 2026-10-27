/* eslint-disable @typescript-eslint/no-require-imports -- Shared CommonJS local certification helper. */
const assert = require('node:assert/strict');

// Opt-in diagnostic: two aggregate queries per interval, no payloads or identities
// retained. The extra database work is part of the profiled benchmark overhead.
module.exports = async function startBacklogSampler(prisma, serviceId, intervalMs = 10000) {
  assert.ok(Number.isInteger(intervalMs) && intervalMs >= 1000 && intervalMs <= 60000);
  const samples = [];
  const started = performance.now();
  let inFlight;
  let errors = 0;
  let truncated = false;
  let stopped;
  const sample = () => {
    if (inFlight) return inFlight;
    if (samples.length >= 1024) {
      truncated = true;
      return Promise.resolve();
    }
    inFlight = (async () => {
      try {
        const [receipts, effects] = await Promise.all([
          prisma.$queryRaw`
            SELECT COUNT(*)::int AS accepted,
              COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
              COUNT(*) FILTER (WHERE status NOT IN ('COMPLETED', 'ARCHIVED'))::int AS pending,
              COALESCE(MAX(EXTRACT(EPOCH FROM (clock_timestamp() - "acceptedAt")) * 1000)
                FILTER (WHERE status NOT IN ('COMPLETED', 'ARCHIVED')), 0)::double precision AS "oldestPendingAgeMs"
            FROM "IngestionReceipt" WHERE "serviceId" = ${serviceId}
          `,
          prisma.$queryRaw`
            SELECT CASE WHEN job.payload->>'lane' IN
                ('PERSONAL_NOTIFICATION','SERVICE_NOTIFICATION','WEBHOOK','WAR_ROOM','STATUS_PAGE','SLACK','INTEGRATION','ORDINARY_DISPATCH')
                THEN job.payload->>'lane' ELSE 'OTHER' END AS lane,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE job.status = 'COMPLETED')::int AS completed,
              COUNT(*) FILTER (WHERE job.status IN ('PENDING', 'PENDING_V2') AND job."scheduledAt" <= clock_timestamp())::int AS due,
              COUNT(*) FILTER (WHERE job.status IN ('PROCESSING', 'PROCESSING_V2'))::int AS processing,
              COUNT(*) FILTER (WHERE job.status = 'FAILED')::int AS failed,
              COALESCE(MAX(EXTRACT(EPOCH FROM (clock_timestamp() - job."scheduledAt")) * 1000)
                FILTER (WHERE job.status IN ('PENDING', 'PENDING_V2') AND job."scheduledAt" <= clock_timestamp()), 0)::double precision AS "oldestDueAgeMs"
            FROM "BackgroundJob" job JOIN "Incident" incident ON incident.id = job.payload->>'incidentId'
            WHERE incident."serviceId" = ${serviceId}
              AND job.type = 'SCHEDULED_TASK' AND job.payload->>'task' = 'EVENT_SIDE_EFFECT'
            GROUP BY 1 ORDER BY 1
          `,
        ]);
        samples.push({ elapsedMs: performance.now() - started, receipts: receipts[0], effects });
      } catch {
        // Never retain raw SQL/errors containing fixture identity or payloads.
        errors++;
      }
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
  await sample();
  const timer = setInterval(() => {
    void sample();
  }, intervalMs);
  timer.unref();
  return function stop() {
    if (stopped) return stopped;
    clearInterval(timer);
    stopped = (async () => {
      await inFlight;
      await sample();
      return {
        scope:
          'Sampled during offered load, before receipt drain. Fixture receipts and initial event-side-effect lanes only; excludes child/provider jobs and external delivery. Two aggregate queries per sample add diagnostic overhead. Not downstream certification.',
        intervalMs,
        errors,
        truncated,
        passed: errors === 0 && !truncated,
        samples,
      };
    })();
    return stopped;
  };
};
