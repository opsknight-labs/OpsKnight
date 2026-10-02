import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'public/readme');

const sources = {
  logo: resolve(root, 'public/logo-mark.png'),
  incident: resolve(root, 'generated/readme-captures/desktop/incident-detail.png'),
  analytics: resolve(root, 'generated/readme-captures/desktop/analytics-overview.png'),
  schedule: resolve(root, 'generated/readme-captures/desktop/on-call-schedule.png'),
  mobileIncident: resolve(root, 'generated/readme-captures/mobile/incident-detail.png'),
  mobileSchedule: resolve(root, 'generated/readme-captures/mobile/on-call-schedules.png'),
  mobileAnalytics: resolve(root, 'generated/readme-captures/mobile/analytics.png'),
};

function mime(file) {
  return file.endsWith('.png') ? 'image/png' : 'image/jpeg';
}

async function dataUrl(file) {
  return `data:${mime(file)};base64,${(await readFile(file)).toString('base64')}`;
}

async function renderWebp(browser, { width, height, html, destination }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await Promise.all([...document.images].map(image => image.decode()));
    await document.fonts.ready;
  });
  const png = await page.screenshot({ type: 'png' });
  const converter = await browser.newPage({ viewport: { width, height } });
  const encoded = await converter.evaluate(
    async ({ image, width: canvasWidth, height: canvasHeight }) => {
      const source = new Image();
      source.src = `data:image/png;base64,${image}`;
      await source.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      canvas.getContext('2d').drawImage(source, 0, 0);
      return canvas.toDataURL('image/webp', 0.9).split(',')[1];
    },
    { image: png.toString('base64'), width, height }
  );
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(encoded, 'base64'));
  await converter.close();
  await page.close();
}

const [logo, incident, analytics, schedule, mobileIncident, mobileSchedule, mobileAnalytics] =
  await Promise.all(Object.values(sources).map(dataUrl));

const sharedStyles = `
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
  body { font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
`;

const browser = await chromium.launch();
try {
  await renderWebp(browser, {
    width: 1600,
    height: 900,
    destination: resolve(output, 'hero.webp'),
    html: `<!doctype html><style>
      ${sharedStyles}
      body { background: #070b13; color: #f8fafc; }
      body::before { content: ""; position: absolute; inset: 0; background:
        radial-gradient(circle at 50% 32%, rgba(225,29,72,.14), transparent 38%),
        linear-gradient(rgba(148,163,184,.045) 1px, transparent 1px),
        linear-gradient(90deg, rgba(148,163,184,.045) 1px, transparent 1px);
        background-size: auto, 56px 56px, 56px 56px; }
      .brand { position: absolute; top: 46px; left: 64px; display: flex; align-items: center; gap: 16px; z-index: 10; }
      .brand img { width: 52px; height: 52px; object-fit: contain; }
      .brand span { font-size: 28px; font-weight: 720; letter-spacing: -.8px; }
      .frame { position: absolute; overflow: hidden; border: 1px solid rgba(255,255,255,.14); border-radius: 16px; background: #0f172a; box-shadow: 0 32px 80px rgba(0,0,0,.5); }
      .frame::before { content: ""; display: block; height: 30px; background: #111827; border-bottom: 1px solid rgba(255,255,255,.1); }
      .frame::after { content: ""; position: absolute; top: 11px; left: 16px; width: 8px; height: 8px; border-radius: 50%; background: #fb7185; box-shadow: 16px 0 #fbbf24, 32px 0 #34d399; }
      .frame img { width: 100%; height: calc(100% - 30px); object-fit: cover; object-position: top; display: block; }
      .analytics { width: 820px; height: 542px; left: 42px; top: 238px; transform: rotate(-4deg); opacity: .72; }
      .schedule { width: 820px; height: 542px; right: 40px; top: 228px; transform: rotate(4deg); opacity: .72; }
      .incident { width: 1120px; height: 730px; left: 240px; top: 128px; z-index: 4; border-color: rgba(248,113,113,.26); }
    </style><div class="brand"><img src="${logo}" alt=""><span>OpsKnight</span></div>
      <div class="frame analytics"><img src="${analytics}" alt=""></div>
      <div class="frame schedule"><img src="${schedule}" alt=""></div>
      <div class="frame incident"><img src="${incident}" alt=""></div>`,
  });

  await renderWebp(browser, {
    width: 1600,
    height: 900,
    destination: resolve(output, 'mobile.webp'),
    html: `<!doctype html><style>
      ${sharedStyles}
      body { background: #080c14; color: #e2e8f0; }
      body::before { content: ""; position: absolute; inset: 0; background:
        radial-gradient(circle at 20% 50%, rgba(225,29,72,.16), transparent 28%),
        radial-gradient(circle at 80% 45%, rgba(59,130,246,.12), transparent 30%); }
      .phone { position: absolute; width: 397px; height: 712px; padding: 22px 10px 18px; border-radius: 54px; background: #020409; border: 1px solid #334155; box-shadow: 0 34px 80px rgba(0,0,0,.58); }
      .phone::before { content: ""; position: absolute; z-index: 3; top: 8px; left: 50%; transform: translateX(-50%); width: 116px; height: 25px; border-radius: 18px; background: #020409; }
      .screen { width: 100%; height: 100%; overflow: hidden; border-radius: 37px; background: #f8fafc; }
      .screen img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
      .left { left: 156px; top: 132px; transform: rotate(-5deg); }
      .center { left: 602px; top: 88px; z-index: 2; }
      .right { right: 156px; top: 132px; transform: rotate(5deg); }
      .label { position: absolute; bottom: 28px; width: 397px; text-align: center; font-size: 15px; font-weight: 650; letter-spacing: 2.4px; color: #94a3b8; }
      .label.left-label { left: 156px; } .label.center-label { left: 602px; } .label.right-label { right: 156px; }
    </style>
      <div class="phone left"><div class="screen"><img src="${mobileSchedule}" alt=""></div></div>
      <div class="phone center"><div class="screen"><img src="${mobileIncident}" alt=""></div></div>
      <div class="phone right"><div class="screen"><img src="${mobileAnalytics}" alt=""></div></div>
      <div class="label left-label">ON-CALL</div><div class="label center-label">INCIDENT RESPONSE</div><div class="label right-label">ANALYTICS</div>`,
  });
} finally {
  await browser.close();
}

console.log(`Wrote ${resolve(output, 'hero.webp')}`);
console.log(`Wrote ${resolve(output, 'mobile.webp')}`);
