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
// The service graph libraries load only on /services/graph: React Flow through next/dynamic, ELK in
// a web worker. Any other runtime import would pull them into shared or route chunks.
const GRAPH_LIBS = /^\s*import\s+(?!type\b)[^;]*from\s+['"](@xyflow\/react|elkjs)[^'"]*['"]/m;
const GRAPH_LIB_OWNERS = new Set([
  'src/components/service-graph/ServiceGraphCanvas.tsx',
  'src/components/service-graph/layout.worker.ts',
]);
const graphLibImporters = ['src/app', 'src/components', 'src/lib', 'src/hooks']
  .flatMap(dir => scanDirectoryForPattern(dir, GRAPH_LIBS))
  .filter(file => !GRAPH_LIB_OWNERS.has(file));
assertBudget(
  graphLibImporters.length === 0,
  `@xyflow/react and elkjs must stay behind the lazy service graph: ${graphLibImporters.join(', ')}`
);
const canvasImporters = ['src/app', 'src/components', 'src/lib', 'src/hooks']
  .flatMap(dir =>
    scanDirectoryForPattern(dir, /^\s*import\s+(?!type\b)[^;]*['"][^'"]*\/ServiceGraphCanvas['"]/m)
  )
  .filter(file => !file.endsWith('ServiceGraphCanvas.tsx'));
assertBudget(
  canvasImporters.length === 0,
  `ServiceGraphCanvas must be loaded with next/dynamic only: ${canvasImporters.join(', ')}`
);
assertBudget(
  /dynamic\(\(\) => import\('\.\/ServiceGraphCanvas'\), \{\s*ssr: false/.test(
    read('src/components/service-graph/ServiceGraphExplorer.tsx')
  ),
  'ServiceGraphExplorer must load ServiceGraphCanvas with next/dynamic and ssr: false'
);
assertBudget(
  /new Worker\(new URL\('\.\/layout\.worker\.ts', import\.meta\.url\)\)/.test(
    read('src/components/service-graph/ServiceGraphCanvas.tsx')
  ),
  'ELK must run in the layout web worker'
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
  // No route's eagerly loaded chunks (nor the shared root files) may carry the graph libraries.
  // App routes list theirs in each page_client-reference-manifest.js (client component chunks);
  // next/dynamic imports and web workers are not in those lists.
  const eager = new Set([
    ...(manifest.rootMainFiles ?? []),
    ...Object.values(manifest.pages ?? {}).flat(),
  ]);
  const appServer = path.join(staticRoot, 'server/app');
  const referenceManifests = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'page_client-reference-manifest.js') referenceManifests.push(full);
    }
  };
  walk(appServer);
  globalThis.__RSC_MANIFEST = {};
  for (const file of referenceManifests) require(file);
  for (const routeManifest of Object.values(globalThis.__RSC_MANIFEST)) {
    for (const module of Object.values(routeManifest.clientModules ?? {})) {
      for (const chunk of module.chunks ?? []) if (chunk.endsWith('.js')) eager.add(chunk);
    }
  }
  const graphChunks = [...eager].filter(asset => {
    const assetPath = path.join(staticRoot, asset);
    if (!asset.endsWith('.js') || !fs.existsSync(assetPath)) return false;
    const source = fs.readFileSync(assetPath, 'utf8');
    return source.includes('react-flow__') || source.includes('org.eclipse.elk');
  });
  assertBudget(
    graphChunks.length === 0,
    `React Flow or ELK reached an eagerly loaded chunk: ${graphChunks.join(', ')}`
  );
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
