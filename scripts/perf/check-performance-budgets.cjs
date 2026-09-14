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

const globalsCss = read('src/app/globals.css');
assertBudget(
  !/\.status-page-[a-zA-Z0-9_-]/.test(globalsCss),
  'globals.css must not contain status-page specific styles; keep them in route-scoped stylesheets'
);

function scanDirectoryForPattern(dir, pattern) {
  const violating = [];
  const fullDir = path.join(root, dir);
  if (!fs.existsSync(fullDir)) return violating;
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      violating.push(...scanDirectoryForPattern(rel, pattern));
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      const content = read(rel);
      if (pattern.test(content)) violating.push(rel);
    }
  }
  return violating;
}

const sidebarStatsConsumers = [
  ...scanDirectoryForPattern('src/components', /\/api\/sidebar-stats/),
  ...scanDirectoryForPattern('src/hooks', /\/api\/sidebar-stats/),
  ...scanDirectoryForPattern('src/app/(app)', /\/api\/sidebar-stats/),
  ...scanDirectoryForPattern('src/app/(mobile)', /\/api\/sidebar-stats/),
];
assertBudget(
  sidebarStatsConsumers.length === 0,
  `authenticated shell dependency graph must not consume /api/sidebar-stats: ${sidebarStatsConsumers.join(', ')}`
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

const appBuildManifestPath = path.join(root, '.next/app-build-manifest.json');
const buildManifestPath = path.join(root, '.next/build-manifest.json');
const manifestPath = fs.existsSync(appBuildManifestPath)
  ? appBuildManifestPath
  : fs.existsSync(buildManifestPath)
    ? buildManifestPath
    : null;

if (!manifestPath) {
  if (process.env.CI) {
    assertBudget(
      false,
      '.next build manifest missing. Run `npm run build` before checking performance budgets in CI.'
    );
  }
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
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
