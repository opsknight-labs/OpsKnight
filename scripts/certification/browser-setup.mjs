import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config({ override: true });

function requireEnv(name) {
  const val = process.env[name];
  if (!val || val.trim().length === 0) {
    throw new Error(`[FATAL] Missing mandatory environment variable: ${name}`);
  }
  return val.trim();
}

async function runSetup() {
  const setupSecret = requireEnv('SETUP_SECRET');
  const adminPassword = requireEnv('ADMIN_PASSWORD');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  
  console.log('Navigating to http://127.0.0.1:3901/setup...');
  await page.goto('http://127.0.0.1:3901/setup', { waitUntil: 'networkidle' });
  
  await page.fill('#setup-name', 'Certification Admin');
  await page.fill('#setup-email', 'cert-admin@opsknight.local');
  await page.fill('#setup-app-url', 'http://127.0.0.1:3900');
  await page.fill('#setup-secret', setupSecret);
  await page.fill('#setup-password', adminPassword);
  await page.fill('#setup-confirm-password', adminPassword);

  await page.screenshot({ path: '/tmp/cert-setup-filled-direct.png' });
  console.log('Submitting form via direct web (port 3901)...');

  await Promise.all([
    page.waitForURL(url => !url.pathname.includes('/setup'), { timeout: 15000 }).catch(e => console.log('Wait url note:', e.message)),
    page.click('button[type="submit"]')
  ]);

  await page.waitForTimeout(3000);
  console.log('Final URL after setup:', page.url());
  await page.screenshot({ path: '/tmp/cert-setup-direct-final.png' });
  
  const text = await page.innerText('body');
  console.log('Body snippet:', text.slice(0, 200));
  await browser.close();
}

runSetup().catch(err => {
  console.error('Setup error:', err);
  process.exit(1);
});
