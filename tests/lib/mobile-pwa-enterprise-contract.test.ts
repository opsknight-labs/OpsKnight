import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('mobile/PWA enterprise architecture contract', () => {
  it('keeps mobile login on the canonical login implementation', () => {
    const mobileLogin = read('src/app/(public)/m/login/page.tsx');
    expect(mobileLogin).toContain("redirect(`/login");
    expect(fs.existsSync(path.join(ROOT, 'src/app/(public)/m/login/MobileLoginClient.tsx'))).toBe(false);
  });

  it('uses one incident lifecycle transport for desktop, mobile and replay', () => {
    const canonicalRoute = read('src/app/api/incidents/[id]/status/route.ts');
    const legacyMobileRoute = read('src/app/api/mobile/incidents/[id]/status/route.ts');
    const client = read('src/lib/incidents/status-client.ts');
    const worker = read('public/custom-sw.js');

    expect(canonicalRoute).toContain('createIncidentStatusRoute');
    expect(legacyMobileRoute).toContain('createIncidentStatusRoute');
    expect(client).toContain('/api/incidents/');
    expect(worker).toContain('/api/incidents/');
    expect(client).not.toContain('/api/mobile/incidents/');
    expect(worker).not.toContain('/api/mobile/incidents/');
  });

  it('never auto-grants notification permission or silently trusts a mobile user-agent', () => {
    const dashboardNotifications = read('src/components/DashboardNotifications.tsx');
    const auth = read('src/lib/auth.ts');

    expect(dashboardNotifications).toContain('onClick={() => void requestPermission()}');
    expect(dashboardNotifications).not.toMatch(/useEffect\([\s\S]{0,500}Notification\.requestPermission\(/);
    expect(auth).toContain("const rememberMe = credentials?.rememberMe === 'true';");
    expect(auth).not.toContain("credentials?.rememberMe === 'true' || isMobileClient");
  });

  it('keeps dynamic authenticated routes and APIs out of service-worker caches', () => {
    const config = read('next.config.ts');
    expect(config).toContain("handler: 'NetworkOnly'");
    expect(config).toContain("url.pathname.startsWith('/m/')");
    expect(config).toContain('extendDefaultRuntimeCaching: false');
    expect(config).toContain('cacheStartUrl: false');
    expect(config).toContain('dynamicStartUrl: false');
  });

  it('requires explicit activation for a waiting service worker', () => {
    const config = read('next.config.ts');
    const coordinator = read('src/components/mobile/MobilePwaCoordinator.tsx');
    const worker = read('public/custom-sw.js');

    expect(config).toContain('skipWaiting: false');
    expect(coordinator).toContain("worker.postMessage({ type: 'SKIP_WAITING' })");
    expect(worker).toContain("event.data.type === 'SKIP_WAITING'");
    expect(worker).not.toContain("self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))");
  });

  it('treats queued responder actions as a durable state machine', () => {
    const queue = read('src/lib/offline-queue.ts');
    const worker = read('public/custom-sw.js');

    for (const state of ['PENDING', 'SENDING', 'SUCCEEDED', 'FAILED', 'CONFLICT', 'AUTH_REQUIRED']) {
      expect(queue).toContain(`'${state}'`);
    }
    expect(queue).toContain('SENDING_LEASE_MS');
    expect(queue).toContain('exponentialBackoffMs');
    expect(worker).toContain('SENDING_LEASE_MS');
    expect(worker).toContain('exponentialBackoffMs');
  });

  it('uses a versioned, same-origin push contract and disables unknown-version actions', () => {
    const worker = read('public/custom-sw.js');
    const producer = read('src/lib/incident-push-delivery.ts');

    expect(worker).toContain('SUPPORTED_PUSH_CONTRACT_VERSIONS');
    expect(worker).toContain('parsed.origin !== self.location.origin');
    expect(worker).toContain('supportedVersion ? parseActions');
    expect(producer).toContain('const PUSH_CONTRACT_VERSION = 2');
    expect(producer).toContain('eventId: notificationId');
    expect(producer).toContain('deliveryId: `web-push:${notificationId}`');
    expect(producer).toContain('url: canonicalIncidentUrl');
  });
});
