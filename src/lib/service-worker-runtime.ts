'use client';

import { ClientAppError } from '@/lib/client-error';
import { ClientTimeoutError, fetchWithTimeout, promiseWithTimeout } from '@/lib/client-timeout';
import { logger } from '@/lib/logger';

export type ServiceWorkerStateClassification =
  | 'HEALTHY_ACTIVE'
  | 'INSTALLING'
  | 'WAITING'
  | 'STALE_REGISTRATION'
  | 'WRONG_WORKER'
  | 'REDUNDANT'
  | 'MISSING'
  | 'UNSUPPORTED'
  | 'FAILED';

export type ServiceWorkerFailureReasonCode =
  | 'SW_UNSUPPORTED'
  | 'SW_INSECURE_CONTEXT'
  | 'SW_NO_REGISTRATION'
  | 'SW_STALE_REGISTRATION'
  | 'SW_INSTALLING'
  | 'SW_INSTALL_STUCK'
  | 'SW_WAITING'
  | 'SW_REDUNDANT'
  | 'SW_ASSET_MISSING'
  | 'SW_ASSET_INVALID'
  | 'SW_IMPORT_FAILED'
  | 'SW_ACTIVATION_TIMEOUT'
  | 'SW_UPDATE_TIMEOUT'
  | 'SW_UNREGISTER_TIMEOUT'
  | 'SW_REGISTRATION_TIMEOUT'
  | 'SW_WRONG_SCOPE'
  | 'SW_WRONG_SCRIPT'
  | 'SW_REPAIR_FAILED';

export type ServiceWorkerHealth = {
  platform: 'ios' | 'android' | 'desktop';
  standalone: boolean;
  secureContext: boolean;
  serviceWorkerSupported: boolean;
  pushManagerAvailable: boolean;
  notificationPermission: NotificationPermission | 'unsupported';
  registrationFound: boolean;
  scope: string | null;
  controllerActive: boolean;
  activeWorker: {
    scriptURL: string | null;
    state: ServiceWorkerState | null;
  } | null;
  waitingWorker: {
    scriptURL: string | null;
    state: ServiceWorkerState | null;
  } | null;
  installingWorker: {
    scriptURL: string | null;
    state: ServiceWorkerState | null;
  } | null;
  classification: ServiceWorkerStateClassification;
  swAssetStatus: string;
  customSwAssetStatus: string;
  repairAttempted: boolean;
  repairResult: string | null;
  lastFailureCode: ServiceWorkerFailureReasonCode | null;
  lastFailureMessage: string | null;
};

export type ActivationPolicy = 'recover-if-no-active' | 'preserve-active-client';

export type EnsureServiceWorkerOptions = {
  purpose?: 'push-enrollment' | 'background-sync' | 'update-check' | 'inspection';
  activationPolicy?: ActivationPolicy;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const BOUNDED_UPDATE_TIMEOUT_MS = 6_000;

export class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      return await fn();
    });
    // Ensure subsequent callers wait even if fn() throws
    this.queue = next.then(
      () => {},
      () => {}
    );
    return next;
  }
}

export const lifecycleMutex = new AsyncMutex();

let lastRepairAttempted = false;
let lastRepairResult: string | null = null;
let lastKnownFailureCode: ServiceWorkerFailureReasonCode | null = null;
let lastKnownFailureMessage: string | null = null;

export function resetServiceWorkerDiagnostics(): void {
  lastRepairAttempted = false;
  lastRepairResult = null;
  lastKnownFailureCode = null;
  lastKnownFailureMessage = null;
}

export function detectPlatform(): 'ios' | 'android' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const userAgent = navigator.userAgent || '';
  const ios =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}

export function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone
  );
}

export function serviceWorkerPath(worker: ServiceWorker | null | undefined): string | null {
  if (!worker?.scriptURL) return null;
  try {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost';
    return new URL(worker.scriptURL, origin).pathname;
  } catch {
    return null;
  }
}

/**
 * Strict validator for OpsKnight Service Worker ownership.
 * A registration is ONLY owned by OpsKnight if at least one attached worker
 * (active, waiting, or installing) has a scriptURL pathname matching '/sw.js'.
 * Scope '/' alone NEVER equals healthy or owned.
 */
export function isOpsKnightServiceWorker(
  registration: ServiceWorkerRegistration | undefined | null
): boolean {
  if (!registration) return false;
  return [registration.active, registration.waiting, registration.installing].some(
    worker => serviceWorkerPath(worker) === '/sw.js'
  );
}

/**
 * Classifies a registration according to deterministic state rules.
 * Scope '/' alone NEVER equals healthy or owned.
 */
export function classifyServiceWorkerRegistration(
  registration: ServiceWorkerRegistration | undefined | null
): ServiceWorkerStateClassification {
  if (!registration) return 'MISSING';

  const workers = [registration.active, registration.waiting, registration.installing].filter(
    (w): w is ServiceWorker => Boolean(w)
  );

  // If there are literally no workers attached at all: scope '/' with no worker is broken
  if (workers.length === 0) {
    return 'STALE_REGISTRATION';
  }

  // Check if any worker belongs to OpsKnight
  const hasOpsKnightWorker = workers.some(w => serviceWorkerPath(w) === '/sw.js');
  if (!hasOpsKnightWorker) {
    return 'WRONG_WORKER';
  }

  // Check for redundant terminal failure
  if (
    workers.every(w => w.state === 'redundant') ||
    (!registration.active && registration.installing?.state === 'redundant')
  ) {
    return 'REDUNDANT';
  }

  // Healthy active worker
  if (registration.active && serviceWorkerPath(registration.active) === '/sw.js') {
    return 'HEALTHY_ACTIVE';
  }

  // Waiting worker with no active worker
  if (registration.waiting && serviceWorkerPath(registration.waiting) === '/sw.js') {
    return 'WAITING';
  }

  // Installing worker with no active worker
  if (registration.installing && serviceWorkerPath(registration.installing) === '/sw.js') {
    return 'INSTALLING';
  }

  return 'FAILED';
}

/**
 * Validates HTTP preflight of both /sw.js and /custom-sw.js.
 */
export async function preflightServiceWorkerAssets(): Promise<{
  swAssetStatus: string;
  customSwAssetStatus: string;
}> {
  let swAssetStatus = 'unknown';
  let customSwAssetStatus = 'unknown';
  const expectedOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost';

  // 1. Verify /sw.js
  let swResponse: Response;
  try {
    swResponse = await fetchWithTimeout(
      '/sw.js',
      {
        cache: 'no-store',
        redirect: 'follow',
        headers: { 'Cache-Control': 'no-cache' },
      },
      8_000
    );
  } catch (error) {
    swAssetStatus = error instanceof Error ? `Fetch failed: ${error.name}` : 'Fetch failed';
    throw new ClientAppError({
      code: 'PUSH_SW_REGISTRATION_FAILED',
      error: 'Push notifications could not reach the service worker file.',
      action: 'Service worker file could not be reached. Check the deployment and retry.',
      retryable: true,
    });
  }

  const swUrl = new URL(swResponse.url || '/sw.js', expectedOrigin);
  const swContentType = swResponse.headers?.get?.('content-type')?.toLowerCase() || '';

  if (swResponse.redirected) {
    swAssetStatus = 'redirected';
    throw new ClientAppError({
      code: 'PUSH_SW_REGISTRATION_FAILED',
      error: 'Push notifications could not validate the service worker file.',
      action:
        swUrl.origin !== expectedOrigin
          ? 'Service worker redirected to another origin. Check reverse proxy or host routing.'
          : 'Service worker endpoint redirected. Serve /sw.js directly without redirects.',
      retryable: true,
    });
  }

  if (swUrl.origin !== expectedOrigin || swUrl.pathname !== '/sw.js') {
    swAssetStatus = `wrong URL: ${swUrl.pathname}`;
    throw new ClientAppError({
      code: 'PUSH_SW_REGISTRATION_FAILED',
      error: 'Push notifications could not validate the service worker file.',
      action: 'Service worker resolved to the wrong URL. Check reverse proxy or host routing.',
      retryable: true,
    });
  }

  if (swResponse.status !== 200) {
    swAssetStatus = `HTTP ${swResponse.status}`;
    throw new ClientAppError({
      code: 'PUSH_SW_REGISTRATION_FAILED',
      error: 'Push notifications could not validate the service worker file.',
      action:
        swResponse.status === 404
          ? 'Service worker file is missing from this deployment.'
          : `Service worker endpoint returned HTTP ${swResponse.status}. Check the deployment.`,
      retryable: true,
    });
  }

  if (!/(?:javascript|ecmascript)/i.test(swContentType)) {
    swAssetStatus = `Invalid MIME: ${swContentType}`;
    throw new ClientAppError({
      code: 'PUSH_SW_REGISTRATION_FAILED',
      error: 'Push notifications could not validate the service worker file.',
      action: swContentType.includes('text/html')
        ? 'Service worker returned HTML instead of JavaScript. Check reverse proxy or host routing.'
        : 'Service worker returned an invalid content type. Serve /sw.js as JavaScript.',
      retryable: true,
    });
  }

  swAssetStatus = `200 ${swContentType}`;

  // 2. Verify /custom-sw.js
  let customResponse: Response;
  try {
    customResponse = await fetchWithTimeout(
      '/custom-sw.js',
      {
        cache: 'no-store',
        redirect: 'follow',
        headers: { 'Cache-Control': 'no-cache' },
      },
      8_000
    );
  } catch (error) {
    customSwAssetStatus = error instanceof Error ? `Fetch failed: ${error.name}` : 'Fetch failed';
    throw new ClientAppError({
      code: 'PUSH_SW_REGISTRATION_FAILED',
      error: 'Service worker dependency (/custom-sw.js) could not be reached.',
      action: 'Service worker dependency could not be reached. Check the deployment.',
      retryable: true,
    });
  }

  const customUrl = new URL(customResponse.url || '/custom-sw.js', expectedOrigin);
  const customContentType = customResponse.headers?.get?.('content-type')?.toLowerCase() || '';

  if (customResponse.redirected) {
    customSwAssetStatus = 'redirected';
    throw new ClientAppError({
      code: 'PUSH_SW_REGISTRATION_FAILED',
      error: 'Service worker dependency (/custom-sw.js) redirected.',
      action:
        'Service worker dependency redirected. Serve /custom-sw.js directly without redirects.',
      retryable: true,
    });
  }

  if (customUrl.origin !== expectedOrigin || customUrl.pathname !== '/custom-sw.js') {
    customSwAssetStatus = `wrong URL: ${customUrl.pathname}`;
    throw new ClientAppError({
      code: 'PUSH_SW_REGISTRATION_FAILED',
      error: 'Service worker dependency (/custom-sw.js) resolved to the wrong URL.',
      action:
        'Service worker dependency resolved to the wrong URL. Check reverse proxy or host routing.',
      retryable: true,
    });
  }

  if (customResponse.status !== 200) {
    customSwAssetStatus = `HTTP ${customResponse.status}`;
    throw new ClientAppError({
      code: 'PUSH_SW_REGISTRATION_FAILED',
      error:
        customResponse.status === 404
          ? 'Service worker dependency is missing from this deployment.'
          : `Service worker dependency returned HTTP ${customResponse.status}.`,
      action:
        customResponse.status === 404
          ? 'Service worker dependency is missing from this deployment.'
          : `Service worker dependency returned HTTP ${customResponse.status}. Check the deployment.`,
      retryable: true,
    });
  }

  if (!/(?:javascript|ecmascript)/i.test(customContentType)) {
    customSwAssetStatus = `Invalid MIME: ${customContentType}`;
    throw new ClientAppError({
      code: 'PUSH_SW_REGISTRATION_FAILED',
      error: customContentType.includes('text/html')
        ? 'Service worker dependency returned HTML instead of JavaScript.'
        : 'Service worker dependency returned an invalid content type.',
      action: customContentType.includes('text/html')
        ? 'Service worker dependency returned HTML instead of JavaScript. Check reverse proxy or host routing.'
        : 'Service worker dependency returned an invalid content type. Serve /custom-sw.js as JavaScript.',
      retryable: true,
    });
  }

  customSwAssetStatus = `200 ${customContentType}`;

  return { swAssetStatus, customSwAssetStatus };
}

/**
 * Actively triggers SKIP_WAITING on a worker.
 */
export function sendSkipWaiting(worker: ServiceWorker | null | undefined): void {
  try {
    if (worker && typeof worker.postMessage === 'function') {
      worker.postMessage({ type: 'SKIP_WAITING' });
    }
  } catch (err) {
    logger.debug('service_worker.skip_waiting_post_message_failed', { error: err });
  }
}

/**
 * Awaits a worker being attached to a registration on browsers (like WebKit)
 * where navigator.serviceWorker.register() resolves before the initial worker
 * property is populated on the registration object.
 */
export async function ensureWorkerAttached(
  registration: ServiceWorkerRegistration,
  timeoutMs = 1_000
): Promise<ServiceWorkerRegistration> {
  if (registration.active || registration.waiting || registration.installing) {
    return registration;
  }

  return new Promise<ServiceWorkerRegistration>(resolve => {
    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      resolved = true;
      if (timer) clearTimeout(timer);
      if (pollInterval) clearInterval(pollInterval);
      if (typeof registration.removeEventListener === 'function') {
        registration.removeEventListener('updatefound', onUpdate);
      }
    };

    const done = () => {
      if (resolved) return;
      cleanup();
      resolve(registration);
    };

    const onUpdate = () => {
      if (registration.installing || registration.waiting || registration.active) {
        done();
      }
    };

    if (typeof registration.addEventListener === 'function') {
      registration.addEventListener('updatefound', onUpdate);
    }

    pollInterval = setInterval(() => {
      if (registration.installing || registration.waiting || registration.active) {
        done();
      }
    }, 25);

    timer = setTimeout(() => {
      done();
    }, timeoutMs);
  });
}

/**
 * Awaits a registration becoming active with explicit activation policy.
 * - If activationPolicy is 'recover-if-no-active', sends SKIP_WAITING to waiting worker
 *   only when registration.active is not present.
 * - If activationPolicy is 'preserve-active-client', preserves active client and does NOT
 *   automatically send SKIP_WAITING to waiting worker.
 */
export async function waitForRegistrationActive(
  registration: ServiceWorkerRegistration,
  timeoutMs: number,
  activationPolicy: ActivationPolicy = 'recover-if-no-active'
): Promise<ServiceWorkerRegistration> {
  if (registration.active) return registration;

  const startTime = Date.now();
  logger.info('service_worker.activation_started', {
    scope: registration.scope,
    timeoutMs,
    activationPolicy,
  });

  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let trackedWorker: ServiceWorker | null = null;

    const cleanup = () => {
      settled = true;
      if (timer) clearTimeout(timer);
      if (pollInterval) clearInterval(pollInterval);
      if (trackedWorker && typeof trackedWorker.removeEventListener === 'function') {
        trackedWorker.removeEventListener('statechange', onStateChange);
      }
      if (typeof registration.removeEventListener === 'function') {
        registration.removeEventListener('updatefound', onUpdateFound);
      }
    };

    const done = () => {
      if (settled) return;
      cleanup();
      logger.info('service_worker.activation_state_change', {
        state: 'activated',
        elapsedMs: Date.now() - startTime,
      });
      resolve(registration);
    };

    const fail = (err: Error) => {
      if (settled) return;
      cleanup();
      reject(err);
    };

    timer = setTimeout(() => {
      if (registration.active) {
        done();
      } else {
        const isStuck = Boolean(registration.installing);
        const err = new ClientTimeoutError(
          isStuck
            ? 'Service worker installation is stuck.'
            : 'The service worker did not become ready.'
        );
        fail(err);
      }
    }, timeoutMs);

    const maybeTriggerSkipWaiting = (worker: ServiceWorker | null | undefined) => {
      if (!registration.active) {
        sendSkipWaiting(worker);
      }
    };

    const onStateChange = () => {
      const state = trackedWorker?.state;
      if (state) {
        logger.info('service_worker.activation_state_change', {
          state,
          elapsedMs: Date.now() - startTime,
        });
      }
      if (registration.active || state === 'activated') {
        done();
      } else if (state === 'installed' && !registration.active) {
        maybeTriggerSkipWaiting(trackedWorker);
      } else if (state === 'redundant') {
        fail(new Error('The service worker installation failed and became redundant.'));
      }
    };

    const onUpdateFound = () => {
      const installing = registration.installing;
      if (installing) {
        if (trackedWorker && typeof trackedWorker.removeEventListener === 'function') {
          trackedWorker.removeEventListener('statechange', onStateChange);
        }
        trackedWorker = installing;
        if (typeof trackedWorker.addEventListener === 'function') {
          trackedWorker.addEventListener('statechange', onStateChange);
        }
      }
    };

    trackedWorker = registration.installing || registration.waiting;
    if (trackedWorker) {
      if (trackedWorker.state === 'activated' || registration.active) {
        done();
        return;
      }
      if (trackedWorker.state === 'redundant') {
        fail(new Error('The service worker installation failed and became redundant.'));
        return;
      }
      if (typeof trackedWorker.addEventListener === 'function') {
        trackedWorker.addEventListener('statechange', onStateChange);
      }
    }

    if (typeof registration.addEventListener === 'function') {
      registration.addEventListener('updatefound', onUpdateFound);
    }

    if (registration.waiting) {
      maybeTriggerSkipWaiting(registration.waiting);
    }

    pollInterval = setInterval(() => {
      if (registration.active) {
        done();
      } else if (registration.waiting) {
        maybeTriggerSkipWaiting(registration.waiting);
      }
    }, 50);
  });
}

/**
 * Attempts a bounded repair on a suspect registration:
 * 1. Calls registration.update() ONLY if active worker exists and it was not stuck installing.
 * 2. Unregisters suspect registration ONCE. If unregister times out, STOPS to avoid stacking jobs.
 * 3. Preflights assets (/sw.js and /custom-sw.js).
 * 4. Calls navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).
 *    If registration times out, STOPS. Never re-calls register() after timeout.
 * 5. Awaits activation.
 */
async function repairServiceWorkerRegistration(
  suspectRegistration: ServiceWorkerRegistration | null,
  timeoutMs: number,
  activationPolicy: ActivationPolicy,
  repairReason:
    | 'STUCK_INSTALLING'
    | 'WAITING_FAILED'
    | 'REDUNDANT'
    | 'STALE'
    | 'WRONG_WORKER' = 'STALE'
): Promise<ServiceWorkerRegistration> {
  lastRepairAttempted = true;
  lastRepairResult = 'in_progress';

  logger.info('service_worker.lifecycle.repair_started', {
    suspectScope: suspectRegistration?.scope,
    activationPolicy,
    repairReason,
  });

  // Step 1: Attempt update() UNLESS the worker was stuck installing or redundant
  const canAttemptUpdate =
    suspectRegistration &&
    typeof suspectRegistration.update === 'function' &&
    repairReason !== 'STUCK_INSTALLING' &&
    repairReason !== 'REDUNDANT' &&
    repairReason !== 'WAITING_FAILED';

  if (canAttemptUpdate && suspectRegistration) {
    const updateTimeoutMs = Math.min(timeoutMs, BOUNDED_UPDATE_TIMEOUT_MS);
    try {
      if (typeof suspectRegistration.update === 'function') {
        logger.info('service_worker.op_started', { op: 'update' });
        const updateStart = Date.now();
        await promiseWithTimeout(
          suspectRegistration.update(),
          updateTimeoutMs,
          'Service worker update timed out during repair.'
        );
        logger.info('service_worker.op_completed', {
          op: 'update',
          durationMs: Date.now() - updateStart,
        });

        const updatedClassification = classifyServiceWorkerRegistration(suspectRegistration);

        // A. HEALTHY_ACTIVE: update completed and active worker is healthy
        if (updatedClassification === 'HEALTHY_ACTIVE' && suspectRegistration.active) {
          lastRepairResult = 'repaired_via_update';
          logger.info('service_worker.lifecycle.repaired_via_update');
          return suspectRegistration;
        }

        // B. WAITING: update found a new worker that is now waiting (with no active worker)
        if (updatedClassification === 'WAITING' && suspectRegistration.waiting) {
          try {
            sendSkipWaiting(suspectRegistration.waiting);
            const ready = await waitForRegistrationActive(
              suspectRegistration,
              timeoutMs,
              activationPolicy
            );
            lastRepairResult = 'repaired_via_update';
            logger.info('service_worker.lifecycle.repaired_via_update');
            return ready;
          } catch (waitErr) {
            logger.warn('service_worker.lifecycle.repair_waiting_activation_failed', {
              error: waitErr,
            });
            // Fall through to unregister & clean register
          }
        }

        // C. INSTALLING: update triggered an active installation (with no active worker)
        if (updatedClassification === 'INSTALLING') {
          try {
            const ready = await waitForRegistrationActive(
              suspectRegistration,
              timeoutMs,
              activationPolicy
            );
            lastRepairResult = 'repaired_via_update';
            logger.info('service_worker.lifecycle.repaired_via_update');
            return ready;
          } catch (installErr) {
            logger.warn('service_worker.lifecycle.repair_installing_activation_failed', {
              error: installErr,
            });
            // Fall through to unregister & clean register
          }
        }
      }
    } catch (updateError) {
      if (updateError instanceof ClientTimeoutError) {
        logger.warn('service_worker.op_timeout', {
          op: 'update',
          timeoutMs: updateTimeoutMs,
        });
        // STOP: timing out an update means WebKit job queue is still processing it.
        // Halting recovery immediately to prevent stacking unregister() on top of a pending update job.
        throw new ClientTimeoutError(
          'Service worker update timed out during repair. Halting recovery to prevent duplicate jobs.'
        );
      } else {
        logger.warn('service_worker.lifecycle.repair_update_attempt_failed', {
          error: updateError,
        });
      }
    }
  }

  // Step 2: Unregister suspect registration ONCE
  if (suspectRegistration) {
    const unregTimeoutMs = Math.min(timeoutMs, BOUNDED_UPDATE_TIMEOUT_MS);
    try {
      if (typeof suspectRegistration.unregister === 'function') {
        logger.info('service_worker.op_started', { op: 'unregister' });
        const unregStart = Date.now();
        const unregResult = await promiseWithTimeout(
          suspectRegistration.unregister(),
          unregTimeoutMs,
          'Service worker unregistration timed out.'
        );
        logger.info('service_worker.op_completed', {
          op: 'unregister',
          success: unregResult,
          durationMs: Date.now() - unregStart,
        });
        if (!unregResult) {
          logger.warn('service_worker.lifecycle.repair_unregister_returned_false');
        }
      }
    } catch (unregError) {
      if (unregError instanceof ClientTimeoutError) {
        logger.warn('service_worker.op_timeout', {
          op: 'unregister',
          timeoutMs: unregTimeoutMs,
        });
        // STOP: timing out an unregister means WebKit job queue is still processing it.
        // Never stack register() on top of an unregister timeout!
        throw new ClientTimeoutError(
          'Service worker unregistration timed out. Halting recovery to prevent duplicate jobs.'
        );
      }
      logger.warn('service_worker.lifecycle.repair_unregister_failed', { error: unregError });
    }
  }

  // Step 3: Validate assets
  await preflightServiceWorkerAssets();

  // Step 4: Fresh registration with updateViaCache: 'none'
  logger.info('service_worker.op_started', { op: 'register' });
  const freshRegStart = Date.now();
  let newRegistration: ServiceWorkerRegistration;
  try {
    newRegistration = await promiseWithTimeout(
      navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      }),
      timeoutMs,
      'Fresh service worker registration timed out.'
    );
    logger.info('service_worker.op_completed', {
      op: 'register',
      durationMs: Date.now() - freshRegStart,
    });
  } catch (freshRegErr) {
    if (freshRegErr instanceof ClientTimeoutError) {
      logger.warn('service_worker.op_timeout', { op: 'register', timeoutMs });
    }
    // STOP: never register again after a timeout
    throw freshRegErr;
  }

  // Step 5: Await activation using recover-if-no-active (the fresh registration has no active client to preserve)
  await ensureWorkerAttached(newRegistration, 1000);
  const activeRegistration = await waitForRegistrationActive(
    newRegistration,
    timeoutMs,
    'recover-if-no-active'
  );

  lastRepairResult = 'repaired';
  lastKnownFailureCode = null;
  lastKnownFailureMessage = null;

  logger.info('service_worker.lifecycle.repair_succeeded', {
    scope: activeRegistration.scope,
  });

  return activeRegistration;
}

/**
 * Global diagnostic snapshot generator.
 */
export async function inspectServiceWorkerHealth(): Promise<ServiceWorkerHealth> {
  const platform = detectPlatform();
  const standalone = isStandaloneMode();
  const secureContext =
    typeof window !== 'undefined' &&
    (window.isSecureContext || window.location.hostname === 'localhost');
  const serviceWorkerSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const pushManagerAvailable = typeof window !== 'undefined' && 'PushManager' in window;
  const notificationPermission =
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';

  let registration: ServiceWorkerRegistration | null = null;
  if (serviceWorkerSupported) {
    try {
      registration = (await navigator.serviceWorker.getRegistration()) ?? null;
    } catch {
      registration = null;
    }
  }

  const classification = classifyServiceWorkerRegistration(registration);
  const controllerActive = serviceWorkerSupported && Boolean(navigator.serviceWorker.controller);

  let swAssetStatus = 'not checked';
  let customSwAssetStatus = 'not checked';
  try {
    const assets = await preflightServiceWorkerAssets();
    swAssetStatus = assets.swAssetStatus;
    customSwAssetStatus = assets.customSwAssetStatus;
  } catch (err) {
    swAssetStatus = err instanceof Error ? err.message : 'failed';
  }

  return {
    platform,
    standalone,
    secureContext,
    serviceWorkerSupported,
    pushManagerAvailable,
    notificationPermission,
    registrationFound: Boolean(registration),
    scope: registration?.scope ?? null,
    controllerActive,
    activeWorker: registration?.active
      ? {
          scriptURL: registration.active.scriptURL,
          state: registration.active.state,
        }
      : null,
    waitingWorker: registration?.waiting
      ? {
          scriptURL: registration.waiting.scriptURL,
          state: registration.waiting.state,
        }
      : null,
    installingWorker: registration?.installing
      ? {
          scriptURL: registration.installing.scriptURL,
          state: registration.installing.state,
        }
      : null,
    classification,
    swAssetStatus,
    customSwAssetStatus,
    repairAttempted: lastRepairAttempted,
    repairResult: lastRepairResult,
    lastFailureCode: lastKnownFailureCode,
    lastFailureMessage: lastKnownFailureMessage,
  };
}

function handleTerminalFailure(
  failureError: unknown,
  registration: ServiceWorkerRegistration | null,
  classification: ServiceWorkerStateClassification,
  startTime: number,
  purpose: string
): never {
  if (failureError instanceof ClientAppError) {
    lastKnownFailureCode = 'SW_ASSET_INVALID';
    lastKnownFailureMessage = failureError.message;
    throw failureError;
  }

  const elapsedMs = Date.now() - startTime;
  const isRedundant = failureError instanceof Error && failureError.message.includes('redundant');
  const isTimeout = failureError instanceof ClientTimeoutError;
  const isUpdateTimeout = isTimeout && failureError.message.includes('update timed out');
  const isUnregisterTimeout =
    isTimeout && failureError.message.includes('unregistration timed out');
  const isRegisterTimeout = isTimeout && failureError.message.includes('registration timed out');
  const isStuckInstall =
    isTimeout &&
    !isUpdateTimeout &&
    !isUnregisterTimeout &&
    !isRegisterTimeout &&
    (failureError.message.includes('stuck') ||
      registration?.installing != null ||
      classification === 'INSTALLING');

  const reasonCode: ServiceWorkerFailureReasonCode = isUpdateTimeout
    ? 'SW_UPDATE_TIMEOUT'
    : isUnregisterTimeout
      ? 'SW_UNREGISTER_TIMEOUT'
      : isRegisterTimeout
        ? 'SW_REGISTRATION_TIMEOUT'
        : isStuckInstall
          ? 'SW_INSTALL_STUCK'
          : isTimeout
            ? 'SW_ACTIVATION_TIMEOUT'
            : isRedundant
              ? 'SW_REDUNDANT'
              : 'SW_REPAIR_FAILED';

  lastKnownFailureCode = reasonCode;
  lastKnownFailureMessage =
    failureError instanceof Error ? failureError.message : String(failureError);
  lastRepairResult = reasonCode;

  logger.error('service_worker.lifecycle.repair_terminal_failure', {
    purpose,
    reasonCode,
    classification,
    elapsedMs,
    scope: registration?.scope ?? null,
    controller: typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller),
    active: registration?.active
      ? { script: registration.active.scriptURL, state: registration.active.state }
      : null,
    waiting: registration?.waiting
      ? { script: registration.waiting.scriptURL, state: registration.waiting.state }
      : null,
    installing: registration?.installing
      ? { script: registration.installing.scriptURL, state: registration.installing.state }
      : null,
    repairPhase: lastRepairResult ?? 'initial',
    platform: detectPlatform(),
    error: failureError instanceof Error ? failureError.message : String(failureError),
  });

  throw new ClientAppError({
    code: 'PUSH_SW_REGISTRATION_FAILED',
    error: isRedundant
      ? 'The service worker installation failed and became redundant.'
      : isStuckInstall
        ? 'The service worker was stuck installing and could not activate.'
        : isUpdateTimeout
          ? 'The service worker update timed out.'
          : isUnregisterTimeout
            ? 'The service worker could not be unregistered cleanly.'
            : isRegisterTimeout
              ? 'The service worker registration timed out.'
              : 'Push setup could not activate the background service.',
    action: isRedundant
      ? 'Service worker installation failed before activation. Retry.'
      : 'Service worker did not become ready. Retry.',
    retryable: true,
  });
}

/**
 * The single authority for discovering, validating, updating, repairing,
 * and converging the OpsKnight service worker into a healthy state.
 *
 * Guarantees:
 * - Normal attempt: 1
 * - Repair attempt: max 1 per user action (no infinite loops)
 * - Safe activation policy differentiation (recover-if-no-active vs preserve-active-client)
 */
export async function ensureHealthyServiceWorker(
  options: EnsureServiceWorkerOptions = {}
): Promise<ServiceWorkerRegistration> {
  const {
    activationPolicy = 'recover-if-no-active',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    purpose = 'inspection',
  } = options;

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    lastKnownFailureCode = 'SW_UNSUPPORTED';
    lastKnownFailureMessage = 'Service workers are not supported by this browser.';
    throw new ClientAppError({
      code: 'PUSH_SW_REGISTRATION_FAILED',
      error: 'Service workers are not supported by this browser.',
      action: 'Use a browser that supports Web Push notifications.',
      retryable: false,
    });
  }

  const isSecure = window.isSecureContext || window.location.hostname === 'localhost';
  if (!isSecure) {
    lastKnownFailureCode = 'SW_INSECURE_CONTEXT';
    lastKnownFailureMessage = 'Push notifications require HTTPS.';
    throw new ClientAppError({
      code: 'PUSH_SW_REGISTRATION_FAILED',
      error: 'Push notifications require HTTPS.',
      action: 'Open OpsKnight over HTTPS and try again.',
      retryable: false,
    });
  }

  return lifecycleMutex.runExclusive(async () => {
    resetServiceWorkerDiagnostics();
    const startTime = Date.now();

    // 1. Discover current registration
    let registration: ServiceWorkerRegistration | null = null;
    try {
      registration =
        (await promiseWithTimeout(
          navigator.serviceWorker.getRegistration(),
          5_000,
          'Service worker lookup timed out.'
        )) ?? null;
    } catch (lookupErr) {
      logger.warn('service_worker.lifecycle.lookup_timeout', { error: lookupErr });
    }

    // 2. Classify registration
    let classification = classifyServiceWorkerRegistration(registration);

    logger.info('service_worker.lifecycle.state_evaluated', {
      purpose,
      classification,
      activationPolicy,
      scope: registration?.scope,
    });

    // 3. Normal path if missing: clean register
    if (classification === 'MISSING') {
      await preflightServiceWorkerAssets();
      try {
        logger.info('service_worker.op_started', { op: 'register' });
        const regStart = Date.now();
        registration = await promiseWithTimeout(
          navigator.serviceWorker.register('/sw.js', { scope: '/' }),
          timeoutMs,
          'Service worker registration timed out.'
        );
        logger.info('service_worker.op_completed', {
          op: 'register',
          durationMs: Date.now() - regStart,
        });
        await ensureWorkerAttached(registration, 1000);
        classification = classifyServiceWorkerRegistration(registration);
      } catch (registerError) {
        if (registerError instanceof ClientTimeoutError) {
          logger.warn('service_worker.op_timeout', { op: 'register', timeoutMs });
          handleTerminalFailure(registerError, registration, classification, startTime, purpose);
        }
        logger.warn('service_worker.lifecycle.initial_register_failed', { error: registerError });
        // Fall through to repair attempt
      }
    }

    // 4. Healthy active state: return registration (bypassing ready on iOS, awaiting ready on desktop)
    // Note: If registration.waiting also exists (ACTIVE + WAITING), we preserve the active worker
    // and do NOT send SKIP_WAITING, allowing MobilePwaCoordinator to display user update prompts.
    if (classification === 'HEALTHY_ACTIVE' && registration?.active) {
      if (detectPlatform() === 'ios') {
        return registration;
      }
      try {
        return await promiseWithTimeout(
          navigator.serviceWorker.ready,
          timeoutMs,
          'The service worker did not become ready.'
        );
      } catch (readyError) {
        if (readyError instanceof ClientTimeoutError) {
          throw new ClientAppError({
            code: 'PUSH_SW_REGISTRATION_FAILED',
            error: 'The service worker did not become ready.',
            action: 'Service worker did not become ready. Retry.',
            retryable: true,
          });
        }
        throw readyError;
      }
    }

    // 5. Waiting worker with no active worker: activate regardless of policy because
    // there is NO active client to preserve!
    if (classification === 'WAITING' && registration) {
      try {
        sendSkipWaiting(registration.waiting);
        return await waitForRegistrationActive(registration, timeoutMs, activationPolicy);
      } catch (waitErr) {
        logger.warn('service_worker.lifecycle.waiting_activation_failed', { error: waitErr });
        // Fall through to repair
      }
    }

    // 6. Installing worker with no active worker: await installation completion.
    // A fresh healthy installation must never be treated as stale or sent to repair!
    if (classification === 'INSTALLING' && registration) {
      try {
        return await waitForRegistrationActive(registration, timeoutMs, activationPolicy);
      } catch (installErr) {
        logger.warn('service_worker.lifecycle.installing_activation_failed', {
          error: installErr,
          elapsedMs: Date.now() - startTime,
        });
        // Fall through to repair
      }
    }

    // 7. Repair path: execute exactly ONCE
    try {
      const repairReason =
        classification === 'INSTALLING'
          ? 'STUCK_INSTALLING'
          : classification === 'REDUNDANT'
            ? 'REDUNDANT'
            : classification === 'WAITING'
              ? 'WAITING_FAILED'
              : classification === 'WRONG_WORKER'
                ? 'WRONG_WORKER'
                : 'STALE';
      const repaired = await repairServiceWorkerRegistration(
        registration,
        timeoutMs,
        activationPolicy,
        repairReason
      );
      return repaired;
    } catch (repairError) {
      handleTerminalFailure(repairError, registration, classification, startTime, purpose);
    }
  });
}
