import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mobile/PWA enterprise architecture contract', () => {
  it('keeps mobile login on the canonical login implementation', () => {
    const mobileLogin = fs.readFileSync('src/app/(public)/m/login/page.tsx', 'utf8');
    expect(mobileLogin).toContain("import LoginPage from '@/app/login/page'");
    expect(mobileLogin).toContain('export default LoginPage');
    expect(fs.existsSync('src/app/(public)/m/login/MobileLoginClient.tsx')).toBe(false);
  });

  it('uses one incident lifecycle transport for desktop, mobile and replay', () => {
    const canonicalRoute = fs.readFileSync('src/app/api/incidents/[id]/status/route.ts', 'utf8');
    const legacyMobileRoute = fs.readFileSync(
      'src/app/api/mobile/incidents/[id]/status/route.ts',
      'utf8'
    );
    const client = fs.readFileSync('src/lib/incidents/status-client.ts', 'utf8');
    const worker = fs.readFileSync('public/custom-sw.js', 'utf8');

    expect(canonicalRoute).toContain('createIncidentStatusRoute');
    expect(legacyMobileRoute).toContain('createIncidentStatusRoute');
    expect(client).toContain('/api/incidents/');
    expect(worker).toContain('/api/incidents/');
    expect(client).not.toContain('/api/mobile/incidents/');
    expect(worker).not.toContain('/api/mobile/incidents/');
  });

  it('never auto-grants notification permission or silently trusts a mobile user-agent', () => {
    const dashboardNotifications = fs.readFileSync(
      'src/components/DashboardNotifications.tsx',
      'utf8'
    );
    const auth = fs.readFileSync('src/lib/auth.ts', 'utf8');

    expect(dashboardNotifications).toContain('onClick={() => void requestPermission()}');
    expect(dashboardNotifications).not.toMatch(
      /useEffect\([\s\S]{0,500}Notification\.requestPermission\(/
    );
    expect(auth).toContain("const rememberMe = credentials?.rememberMe === 'true';");
    expect(auth).not.toContain("credentials?.rememberMe === 'true' || isMobileClient");
  });

  it('keeps dynamic authenticated routes and APIs out of service-worker caches', () => {
    const config = fs.readFileSync('next.config.ts', 'utf8');
    expect(config).toContain("handler: 'NetworkOnly'");
    expect(config).toContain("url.pathname.startsWith('/m/')");
    expect(config).toContain('extendDefaultRuntimeCaching: false');
    expect(config).toContain('cacheStartUrl: false');
    expect(config).toContain('dynamicStartUrl: false');
  });

  it('requires explicit activation for a waiting service worker', () => {
    const config = fs.readFileSync('next.config.ts', 'utf8');
    const coordinator = fs.readFileSync('src/components/mobile/MobilePwaCoordinator.tsx', 'utf8');
    const worker = fs.readFileSync('public/custom-sw.js', 'utf8');

    expect(config).toContain('skipWaiting: false');
    expect(coordinator).toContain("worker.postMessage({ type: 'SKIP_WAITING' })");
    expect(worker).toContain("event.data.type === 'SKIP_WAITING'");
    expect(worker).not.toContain(
      "self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))"
    );
  });

  it('binds responder cache and offline replay to the authenticated principal generation', () => {
    const cache = fs.readFileSync('src/lib/mobile-cache.ts', 'utf8');
    const queue = fs.readFileSync('src/lib/offline-queue.ts', 'utf8');
    const coordinator = fs.readFileSync('src/components/mobile/MobilePwaCoordinator.tsx', 'utf8');
    const authPurge = fs.readFileSync('src/lib/auth-cache-purge.ts', 'utf8');
    const worker = fs.readFileSync('public/custom-sw.js', 'utf8');

    expect(cache).toContain('principalStorageSegment(context)');
    expect(cache).toContain('stored.principalId !== context.principalId');
    expect(cache).toContain('stored.authGeneration !== context.authGeneration');
    expect(cache).toContain('purgeMobileCacheStorage');
    expect(queue).toContain('principalId: principal.principalId');
    expect(queue).toContain('authGeneration: principal.authGeneration');
    expect(coordinator).toContain("type: 'SET_ACTIVE_PRINCIPAL'");
    expect(authPurge).toContain('purgeMobileCacheStorage');
    expect(authPurge).toContain('purgeOfflineQueueStorage');
    expect(worker).toContain("event.data.type === 'SET_ACTIVE_PRINCIPAL'");
  });

  it('serializes dependent actions per resource while allowing independent resource lanes', () => {
    const queue = fs.readFileSync('src/lib/offline-queue.ts', 'utf8');
    const worker = fs.readFileSync('public/custom-sw.js', 'utf8');

    for (const state of [
      'PENDING',
      'SENDING',
      'SUCCEEDED',
      'FAILED',
      'FORBIDDEN',
      'CONFLICT',
      'AUTH_REQUIRED',
    ]) {
      expect(queue).toContain(`'${state}'`);
    }
    expect(queue).toContain('laneKey');
    expect(queue).toContain('firstPerLane');
    expect(queue).toContain('MAX_PARALLEL_LANES');
    expect(queue).toContain('claimRequest');
    expect(queue).toContain('leaseOwner');
    expect(queue).toContain("db.transaction(STORE_NAME, 'readwrite')");
    expect(worker).toContain('laneKey');
    expect(worker).toContain('claimRequest');
    expect(worker).toContain('leaseOwner');
    expect(worker).toContain('MAX_PARALLEL_LANES');
  });

  it('uses a versioned, same-origin push contract and disables unknown-version actions', () => {
    const worker = fs.readFileSync('public/custom-sw.js', 'utf8');
    const producer = fs.readFileSync('src/lib/incident-push-delivery.ts', 'utf8');

    expect(worker).toContain('SUPPORTED_PUSH_CONTRACT_VERSIONS');
    expect(worker).toContain('parsed.origin !== self.location.origin');
    expect(worker).toContain('supportedVersion ? parseActions');
    expect(producer).toContain('const PUSH_CONTRACT_VERSION = 2');
    expect(producer).toContain('eventId: notificationId');
    expect(producer).toContain('deliveryId: `web-push:${notificationId}`');
    expect(producer).toContain('url: canonicalIncidentUrl');
  });

  it('uses one responsive design system instead of parallel mobile UI foundations', () => {
    const mobileLayout = fs.readFileSync('src/app/(mobile)/m/layout.tsx', 'utf8');
    const shellCss = fs.readFileSync('src/app/(mobile)/m/mobile-shell.css', 'utf8');
    const dialog = fs.readFileSync('src/components/ui/shadcn/dialog.tsx', 'utf8');
    const mobileButton = fs.readFileSync('src/components/mobile/MobileButton.tsx', 'utf8');
    const mobileCard = fs.readFileSync('src/components/mobile/MobileCard.tsx', 'utf8');

    expect(mobileLayout).toContain("import './mobile-shell.css'");
    expect(mobileLayout).not.toContain('mobile-premium.css');
    expect(mobileLayout).not.toContain('mobile-hardening.css');
    expect(fs.existsSync('src/app/(mobile)/m/mobile-premium.css')).toBe(false);
    expect(fs.existsSync('src/app/(mobile)/m/mobile-hardening.css')).toBe(false);
    expect(fs.existsSync('src/components/mobile/MobileModal.tsx')).toBe(false);
    expect(fs.existsSync('src/components/mobile/MobileBottomSheet.tsx')).toBe(false);
    expect(shellCss).toContain('env(safe-area-inset-bottom');
    expect(shellCss).toContain('min-height: 44px');
    expect(dialog).toContain('safe-area-inset-bottom');
    expect(mobileButton).toContain("@/components/ui/shadcn/button");
    expect(mobileCard).toContain("@/components/ui/shadcn/card");
  });

  it('shares the complete incident detail experience across desktop and mobile', () => {
    const desktopPage = fs.readFileSync('src/app/(app)/incidents/[id]/page.tsx', 'utf8');
    const mobilePage = fs.readFileSync('src/app/(mobile)/m/incidents/[id]/page.tsx', 'utf8');
    const sharedDetail = fs.readFileSync('src/components/incident/IncidentDetailScreen.tsx', 'utf8');

    expect(desktopPage).toContain('IncidentDetailScreen');
    expect(mobilePage).toContain('IncidentDetailScreen');
    expect(fs.existsSync('src/app/(mobile)/m/incidents/[id]/actions.tsx')).toBe(false);
    expect(sharedDetail).toContain('IncidentSLABadges');
    expect(sharedDetail).toContain('IncidentCommandBar');
    expect(sharedDetail).toContain('IncidentWatchers');
    expect(sharedDetail).toContain('IncidentCustomFieldsCard');
    expect(sharedDetail).toContain('IncidentQuickLinksCard');
    expect(sharedDetail).toContain('getJiraCapabilities');
  });

  it('keeps mobile home and incident list on the request-scoped actor contract', () => {
    const home = fs.readFileSync('src/app/(mobile)/m/page.tsx', 'utf8');
    const incidents = fs.readFileSync('src/app/(mobile)/m/incidents/page.tsx', 'utf8');
    const incidentCard = fs.readFileSync('src/components/mobile/SwipeableIncidentCard.tsx', 'utf8');

    expect(home).toContain('getRequestActorContext');
    expect(home).not.toContain('getServerSession');
    expect(home).not.toContain('getCurrentAuthorizationActor');
    expect(incidents).toContain('getRequestActorContext');
    expect(incidents).not.toContain('getCurrentAuthorizationActor');
    expect(incidentCard).toContain('Acknowledge');
    expect(incidentCard).toContain('View details');
  });
});
