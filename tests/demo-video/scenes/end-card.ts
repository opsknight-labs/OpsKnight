import * as fs from 'fs';
import * as path from 'path';
import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 17: End Card
 * Fade everything away -> OpsKnight Logo -> Tagline -> GitHub repo link & star callout.
 */
export async function playEndCardScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('OpsKnight', 'Detect. Respond. Communicate. Learn.', 'end-card');
  await director.hideChapterHud();
  await director.hideCursor();

  // Load official logo mark as base64 to ensure instant rendering
  const logoPath = path.resolve(process.cwd(), 'public/logo-mark.png');
  const logoBase64 = fs.existsSync(logoPath)
    ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
    : '/logo.png';

  // Injected sleek end card screen with official OpsKnight branding
  await page.evaluate(({ logoSrc }) => {
    const endCard = document.createElement('div');
    endCard.id = 'demo-end-card';
    endCard.innerHTML = `
      <style>
        #demo-end-card {
          position: fixed;
          inset: 0;
          z-index: 2147483640;
          background: radial-gradient(circle at 50% 45%, #ffffff 0%, #f8fafc 65%, #f1f5f9 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #0f172a;
          animation: demoFadeIn 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes demoFadeIn {
          0% { opacity: 0; transform: scale(0.97); }
          100% { opacity: 1; transform: scale(1); }
        }
        .endcard-logo-box {
          width: 96px;
          height: 96px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #ffffff;
          border: 1px solid rgba(220, 38, 38, 0.18);
          border-radius: 26px;
          box-shadow: 0 16px 40px -10px rgba(220, 38, 38, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.04);
        }
        .endcard-logo-img {
          width: 76px;
          height: 76px;
          object-fit: contain;
        }
        .endcard-title {
          font-size: 52px;
          font-weight: 800;
          letter-spacing: -0.03em;
          color: #0f172a;
          margin: 0;
        }
        .endcard-tagline {
          font-size: 21px;
          font-weight: 500;
          color: #475569;
          margin-top: 12px;
          letter-spacing: -0.01em;
        }
        .endcard-lead {
          font-size: 15px;
          font-weight: 700;
          color: #dc2626;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          margin-top: 8px;
        }
        .endcard-footer {
          margin-top: 36px;
          display: flex;
          align-items: center;
          gap: 18px;
        }
        .endcard-link {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 22px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 9999px;
          font-size: 14px;
          font-weight: 600;
          color: #1e293b;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
        }
        .endcard-star {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 22px;
          background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
          border-radius: 9999px;
          font-size: 14px;
          font-weight: 700;
          color: #ffffff;
          box-shadow: 0 4px 16px rgba(220, 38, 38, 0.35);
        }
      </style>
      <div class="endcard-logo-box">
        <img src="${logoSrc}" alt="OpsKnight" class="endcard-logo-img" />
      </div>
      <h1 class="endcard-title">OpsKnight</h1>
      <p class="endcard-tagline">Detect. Respond. Communicate. Learn.</p>
      <p class="endcard-lead">Open-source incident operations</p>
      <div class="endcard-footer">
        <div class="endcard-link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
          </svg>
          github.com/opsknight-labs/OpsKnight
        </div>
        <div class="endcard-star">
          ★ Star on GitHub
        </div>
      </div>
    `;
    document.body.appendChild(endCard);
  }, { logoSrc: logoBase64 });

  await director.pause(7000);
}
