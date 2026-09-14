const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function size(relativePath) {
  return fs.statSync(path.join(root, relativePath)).size;
}

function assertBudget(condition, message) {
  if (!condition) throw new Error(`Performance budget failed: ${message}`);
}

const rootStyles = read('src/styles/index.css');
const sidebar = read('src/components/Sidebar.tsx');
const activityTracker = read('src/components/auth/ActivityTracker.tsx');
const rootProviders = read('src/app/providers.tsx');
const serviceNotifications = read('src/lib/service-notifications.ts');

for (const stylesheet of [
  'mobile.css',
  'schedule.css',
  'analytics.css',
  'status-page.css',
  'settings.css',
  'users.css',
]) {
  assertBudget(
    !rootStyles.includes(`./pages/${stylesheet}`),
    `${stylesheet} must remain route-owned instead of entering the root CSS bundle`
  );
}

assertBudget(
  !sidebar.includes("fetch('/api/sidebar-stats')"),
  'Sidebar must not fetch database-backed metadata during navigation'
);
assertBudget(
  !/const handleUserActivity = \(\) => \{[^}]*\bupdate\(/.test(activityTracker),
  'user interaction handlers must not invoke a session update'
);
assertBudget(
  !rootProviders.includes('SessionProvider') && !rootProviders.includes('ActivityTracker'),
  'authenticated providers must not be included on public routes'
);
assertBudget(
  !/^import .*microsoft-teams\/delivery/m.test(serviceNotifications),
  'Microsoft Teams delivery must be loaded only when its channel is used'
);
assertBudget(size('src/app/globals.css') <= 96_000, 'legacy global CSS exceeds 96 KB');
assertBudget(size('src/styles/index.css') <= 8_000, 'root CSS entry exceeds 8 KB');

const buildManifestPath = path.join(root, '.next/app-build-manifest.json');
if (fs.existsSync(buildManifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(buildManifestPath, 'utf8'));
  const staticRoot = path.join(root, '.next');
  for (const [route, assets] of Object.entries(manifest.pages ?? {})) {
    const totals = { js: 0, css: 0 };
    for (const asset of assets) {
      const assetPath = path.join(staticRoot, asset);
      if (!fs.existsSync(assetPath)) continue;
      if (asset.endsWith('.js')) totals.js += fs.statSync(assetPath).size;
      if (asset.endsWith('.css')) totals.css += fs.statSync(assetPath).size;
    }
    assertBudget(totals.js <= 1_250_000, `${route} JavaScript exceeds 1.25 MB`);
    assertBudget(totals.css <= 350_000, `${route} CSS exceeds 350 KB`);
  }
}

console.log('Performance budgets passed.');
