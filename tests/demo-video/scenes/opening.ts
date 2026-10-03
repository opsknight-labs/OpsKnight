import * as fs from 'fs';
import * as path from 'path';
import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 01: Opening
 * Clean OpsKnight logo & title sequence, then transition into real dashboard.
 */
export async function playOpeningScene(director: DemoDirector): Promise<void> {
  const page = director.page;
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await director.setChapter('OpsKnight', 'Open-source incident management & on-call operations', 'opening');
  await director.hideCursor();

  // Load official logo mark as base64 to ensure instant rendering without network latency
  const logoPath = path.resolve(process.cwd(), 'public/logo-mark.png');
  const logoBase64 = fs.existsSync(logoPath)
    ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
    : '/logo.png';

  // Render high-end opening title card with official OpsKnight branding
  await page.evaluate(({ logoSrc }) => {
    const splash = document.createElement('div');
    splash.id = 'demo-opening-splash';
    splash.innerHTML = `
      <style>
        #demo-opening-splash {
          position: fixed;
          inset: 0;
          z-index: 2147483640;
          background: radial-gradient(circle at 50% 40%, #ffffff 0%, #f8fafc 60%, #f1f5f9 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #0f172a;
          animation: demoFadeInOut 6.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes demoFadeInOut {
          0% { opacity: 0; transform: scale(0.98); }
          12% { opacity: 1; transform: scale(1); }
          82% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.02); pointer-events: none; }
        }
        .splash-logo-box {
          position: relative;
          width: 104px;
          height: 104px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #ffffff;
          border: 1px solid rgba(220, 38, 38, 0.18);
          border-radius: 28px;
          box-shadow: 0 16px 40px -10px rgba(220, 38, 38, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.04);
        }
        .splash-logo-img {
          width: 82px;
          height: 82px;
          object-fit: contain;
        }
        .splash-title {
          font-size: 54px;
          font-weight: 800;
          letter-spacing: -0.03em;
          color: #0f172a;
          margin: 0;
        }
        .splash-subtitle {
          font-size: 20px;
          font-weight: 500;
          color: #475569;
          margin-top: 10px;
          letter-spacing: -0.01em;
        }
        .splash-badge {
          margin-top: 26px;
          padding: 6px 18px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 700;
          color: #dc2626;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          box-shadow: 0 2px 8px rgba(220, 38, 38, 0.08);
        }
      </style>
      <div class="splash-logo-box">
        <img src="${logoSrc}" alt="OpsKnight" class="splash-logo-img" />
      </div>
      <h1 class="splash-title">OpsKnight</h1>
      <p class="splash-subtitle">Open-source incident management & on-call operations</p>
      <div class="splash-badge">Master Product Tour</div>
    `;
    document.body.appendChild(splash);
  }, { logoSrc: logoBase64 });

  await director.pause(6000);

  await page.evaluate(() => {
    const el = document.getElementById('demo-opening-splash');
    if (el) el.remove();
  });
}
