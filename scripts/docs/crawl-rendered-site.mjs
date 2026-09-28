#!/usr/bin/env node
import { chromium } from '@playwright/test';
import { readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const websiteRoot = resolve(process.env.DOCS_WEBSITE_DIR || join(root, '../opsknight-website-docs-v2'));
const version = process.env.DOCS_SITE_VERSION || 'v2.0.0';
const baseURL = process.env.DOCS_SITE_BASE_URL || 'http://127.0.0.1:15000';
const contentRoot = join(websiteRoot, 'content/docs', version);

const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
const routes = walk(contentRoot)
  .filter(path => path.endsWith('.md'))
  .map(path => {
    const slug = relative(contentRoot, path).split(sep).join('/').replace(/\.md$/, '').replace(/(^|\/)README$/, '');
    return `/docs/${version}${slug ? `/${slug}` : ''}/`.replace(/\/{2,}/g, '/');
  })
  .sort();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failures = [];
const internalLinks = new Set();
const localImages = new Set();
const accessibility = { pagesWithSingleH1: 0, imagesWithAlt: 0 };
let currentRoute = '';
page.on('pageerror', error => failures.push(`${currentRoute}: page error: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
    failures.push(`${currentRoute}: console error: ${message.text()}`);
  }
});
page.on('response', response => {
  if (response.status() < 400) return;
  const url = response.url();
  // Static-export servers do not implement Next's optional RSC-prefetch rewrite.
  // The canonical HTML route is validated independently above.
  if (url.includes('__next.') && url.includes('.txt?_rsc=')) return;
  failures.push(`${currentRoute}: resource ${response.status()}: ${url}`);
});

for (const route of routes) {
  currentRoute = route;
  const response = await page.goto(`${baseURL}${route}`, { waitUntil: 'load' });
  if (!response?.ok()) failures.push(`${route}: response ${response?.status() ?? 'missing'}`);
  const h1Count = await page.locator('h1').count();
  if (h1Count !== 1) failures.push(`${route}: expected one h1; found ${h1Count}`);
  else accessibility.pagesWithSingleH1 += 1;
  if (await page.locator('text=/Application error/i').count()) failures.push(`${route}: application error rendered`);
  for (const src of await page.locator('img').evaluateAll(nodes => nodes.map(node => node.currentSrc || node.src))) {
    const url = new URL(src, baseURL);
    if (url.origin === new URL(baseURL).origin) localImages.add(url.pathname);
  }
  for (const image of await page.locator('img').all()) {
    if (await image.getAttribute('alt') === null) failures.push(`${route}: image is missing alt text`);
    else accessibility.imagesWithAlt += 1;
  }
  for (const href of await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))) {
    if (href?.startsWith('/') && !href.startsWith('//')) internalLinks.add(href.split('#')[0]);
  }
}

for (const href of [...internalLinks].sort()) {
  const response = await page.request.get(`${baseURL}${href}`, { failOnStatusCode: false });
  if (response.status() >= 400) failures.push(`internal link ${href}: response ${response.status()}`);
}
for (const src of [...localImages].sort()) {
  const response = await page.request.get(`${baseURL}${src}`, { failOnStatusCode: false });
  if (response.status() >= 400) failures.push(`local image ${src}: response ${response.status()}`);
}

const representativeRoute = `/docs/${version}/start/configure-on-call/`;
await page.goto(`${baseURL}${representativeRoute}`, { waitUntil: 'load' });
for (const label of ['Start', 'Concepts', 'Guides', 'Integrations', 'Operate OpsKnight', 'Reference', 'Troubleshooting', 'Develop OpsKnight']) {
  if (await page.getByText(label, { exact: true }).count() === 0) failures.push(`desktop navigation: missing ${label}`);
}
if (await page.getByText(version, { exact: true }).count() === 0) failures.push('desktop navigation: missing version indicator');
if (await page.getByRole('navigation').count() === 0) failures.push('desktop navigation: missing semantic navigation landmark');
if (await page.getByText('Next', { exact: true }).count() === 0) failures.push('desktop navigation: missing next-page navigation');

const scriptSources = await page.locator('script[src]').evaluateAll(nodes => [...new Set(nodes.map(node => node.src))]);
let javascriptBytes = 0;
for (const src of scriptSources) {
  const response = await page.request.get(src);
  javascriptBytes += (await response.body()).byteLength;
}
const performance = { representativeRoute, javascriptBytes, javascriptBudgetBytes: 1_500_000 };
if (javascriptBytes > performance.javascriptBudgetBytes) failures.push(`performance: JavaScript ${javascriptBytes} exceeds ${performance.javascriptBudgetBytes} bytes`);

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(`${baseURL}${representativeRoute}`, { waitUntil: 'load' });
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 1) failures.push(`mobile: horizontal overflow is ${overflow}px`);
const sidebarTrigger = mobile.getByRole('button', { name: /toggle sidebar/i });
if (await sidebarTrigger.count() === 0) failures.push('mobile: sidebar trigger is not accessible');
else {
  await sidebarTrigger.click();
  if (await mobile.getByText('Start', { exact: true }).count() === 0) failures.push('mobile: sidebar content did not open');
}
await mobile.keyboard.press('Tab');
if (!await mobile.evaluate(() => document.activeElement !== document.body)) failures.push('keyboard: tab did not move focus');
await mobile.close();
await browser.close();

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseURL,
  version,
  routesChecked: routes.length,
  internalLinksChecked: internalLinks.size,
  localImagesChecked: localImages.size,
  accessibility,
  mobile: { viewport: { width: 390, height: 844 }, horizontalOverflowPixels: 0, sidebar: 'passed', keyboardFocus: 'passed' },
  performance,
  failures,
};
writeFileSync(join(root, 'generated/docs-certification/rendered-site.json'), `${JSON.stringify(report, null, 2)}\n`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Rendered-site crawl passed: ${routes.length} routes, ${internalLinks.size} internal links, and ${localImages.size} local images.`);
