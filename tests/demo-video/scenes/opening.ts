import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 01: Opening
 * Clean OpsKnight logo & title sequence, then transition into real dashboard.
 */
export async function playOpeningScene(director: DemoDirector): Promise<void> {
  const page = director.page;
  await director.setChapter('OpsKnight', 'Open-source incident management & on-call operations', 'opening');

  // Render high-end opening title card
  await page.evaluate(() => {
    const splash = document.createElement('div');
    splash.id = 'demo-opening-splash';
    splash.innerHTML = `
      <style>
        #demo-opening-splash {
          position: fixed;
          inset: 0;
          z-index: 2147483640;
          background: radial-gradient(circle at 50% 40%, #1e1b4b 0%, #090d16 70%, #030712 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #ffffff;
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
          width: 96px;
          height: 96px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(168, 85, 247, 0.1) 100%);
          border: 1px solid rgba(129, 140, 248, 0.35);
          border-radius: 28px;
          box-shadow: 0 0 50px rgba(99, 102, 241, 0.35);
        }
        .splash-title {
          font-size: 52px;
          font-weight: 800;
          letter-spacing: -0.03em;
          background: linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin: 0;
        }
        .splash-subtitle {
          font-size: 20px;
          font-weight: 500;
          color: #94a3b8;
          margin-top: 10px;
          letter-spacing: -0.01em;
        }
        .splash-badge {
          margin-top: 28px;
          padding: 6px 16px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 600;
          color: #818cf8;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
      </style>
      <div class="splash-logo-box">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <path d="m9 12 2 2 4-4"/>
        </svg>
      </div>
      <h1 class="splash-title">OpsKnight</h1>
      <p class="splash-subtitle">Open-source incident management & on-call operations</p>
      <div class="splash-badge">Master Product Tour</div>
    `;
    document.body.appendChild(splash);
  });

  await director.pause(6000);

  await page.evaluate(() => {
    const el = document.getElementById('demo-opening-splash');
    if (el) el.remove();
  });
}
