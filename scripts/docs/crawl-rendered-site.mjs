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
    return `/docs/${version}${slug ? `/${slug}` : ''}`;
  })
  .sort();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failures = [];
const internalLinks = new Set();
const localImages = new Set();
let currentRoute = '';
page.on('pageerror', error => failures.push(`${currentRoute}: page error: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') failures.push(`${currentRoute}: console error: ${message.text()}`);
});

for (const route of routes) {
  currentRoute = route;
  const response = await page.goto(`${baseURL}${route}`, { waitUntil: 'load' });
  if (!response?.ok()) failures.push(`${route}: response ${response?.status() ?? 'missing'}`);
  if (await page.locator('h1').count() === 0) failures.push(`${route}: missing h1`);
  if (await page.locator('text=/Application error/i').count()) failures.push(`${route}: application error rendered`);
  for (const src of await page.locator('img').evaluateAll(nodes => nodes.map(node => node.currentSrc || node.src))) {
    const url = new URL(src, baseURL);
    if (url.origin === new URL(baseURL).origin) localImages.add(url.pathname);
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
await browser.close();

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseURL,
  version,
  routesChecked: routes.length,
  internalLinksChecked: internalLinks.size,
  localImagesChecked: localImages.size,
  failures,
};
writeFileSync(join(root, 'generated/docs-certification/rendered-site.json'), `${JSON.stringify(report, null, 2)}\n`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Rendered-site crawl passed: ${routes.length} routes, ${internalLinks.size} internal links, and ${localImages.size} local images.`);
