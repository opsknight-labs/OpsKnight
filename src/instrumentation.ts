/**
 * Next.js Instrumentation
 *
 * This file is automatically loaded by Next.js at startup.
 * It runs once when the server starts, before any requests are handled.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

let shutdownHandlersRegistered = false;
let stopScheduler: (() => Promise<void>) | null = null;
let stopJobWorkerService: (() => Promise<void>) | null = null;
let shutdownPromise: Promise<void> | null = null;

async function stopRuntimeServices(): Promise<void> {
  const stops: Promise<void>[] = [];

  if (stopScheduler) {
    stops.push(stopScheduler());
  }

  if (stopJobWorkerService) {
    stops.push(stopJobWorkerService());
  }

  const results = await Promise.allSettled(stops);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[Runtime] Graceful shutdown failed', result.reason);
    }
  }

  stopScheduler = null;
  stopJobWorkerService = null;
}

function requestShutdown(): void {
  if (!shutdownPromise) {
    shutdownPromise = stopRuntimeServices()
      .catch(error => {
        console.error('[Runtime] Graceful shutdown failed', error);
      })
      .finally(() => {
        shutdownPromise = null;
      });
  }
  void shutdownPromise;
}

export async function register() {
  // Only run validation in Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Skip validation during build phase
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return;
    }

    // Validate production environment variables at startup
    const { validateProductionEnv } = await import('./lib/env-validation');
    validateProductionEnv();

    const { getOpsKnightProcessRole, getRuntimeResponsibilities } =
      await import('./lib/runtime-role');
    const role = getOpsKnightProcessRole();
    const responsibilities = getRuntimeResponsibilities(role);

    // Keep Node-only runtime imports inside the Node runtime guard. Next.js also
    // analyzes instrumentation for non-Node targets during build, and moving
    // these imports outside this guard can pull Node-only provider modules into
    // an incompatible bundle.
    if (responsibilities.startScheduler) {
      const { startCronScheduler, stopCronScheduler } = await import('./lib/cron-scheduler');
      startCronScheduler();
      stopScheduler = stopCronScheduler;
    }

    if (responsibilities.startJobWorker) {
      const { startJobWorker, stopJobWorker } = await import('./lib/job-worker');
      startJobWorker();
      stopJobWorkerService = stopJobWorker;
    }

    const { logger } = await import('./lib/logger');
    logger.info('[Runtime] Process role initialized', {
      role,
      scheduler: responsibilities.startScheduler,
      jobWorker: responsibilities.startJobWorker,
    });

    if (!shutdownHandlersRegistered) {
      shutdownHandlersRegistered = true;
      process.once('SIGTERM', requestShutdown);
      process.once('SIGINT', requestShutdown);
    }
  }
}
