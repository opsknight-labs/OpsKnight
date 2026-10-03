import { type DemoDirector } from '../helpers/demo-director';

/**
 * Scene 17: End Card
 * Fade everything away -> OpsKnight Logo -> Tagline -> GitHub repo link & star callout.
 */
export async function playEndCardScene(director: DemoDirector): Promise<void> {
  const page = director.page;

  await director.setChapter('OpsKnight', 'Detect. Respond. Communicate. Learn.', 'end-card');
  await director.hideChapterHud();

  // Injected sleek end card screen
  await page.evaluate(() => {
    const endCard = document.createElement('div');
    endCard.id = 'demo-end-card';
    endCard.innerHTML = `
      <style>
        #demo-end-card {
          position: fixed;
          inset: 0;
          z-index: 2147483640;
          background: radial-gradient(circle at 50% 45%, #1e1b4b 0%, #090d16 65%, #030712 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #ffffff;
          animation: demoFadeIn 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes demoFadeIn {
          0% { opacity: 0; transform: scale(0.97); }
          100% { opacity: 1; transform: scale(1); }
        }
        .endcard-logo-box {
          width: 88px;
          height: 88px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(168, 85, 247, 0.15) 100%);
          border: 1px solid rgba(129, 140, 248, 0.4);
          border-radius: 26px;
          box-shadow: 0 0 60px rgba(99, 102, 241, 0.45);
        }
        .endcard-title {
          font-size: 50px;
          font-weight: 800;
          letter-spacing: -0.03em;
          background: linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin: 0;
        }
        .endcard-tagline {
          font-size: 21px;
          font-weight: 500;
          color: #94a3b8;
          margin-top: 14px;
          letter-spacing: -0.01em;
        }
        .endcard-lead {
          font-size: 15px;
          font-weight: 600;
          color: #818cf8;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          margin-top: 8px;
        }
        .endcard-footer {
          margin-top: 36px;
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .endcard-link {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 22px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 9999px;
          font-size: 14px;
          font-weight: 600;
          color: #ffffff;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        }
        .endcard-star {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 20px;
          background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
          border-radius: 9999px;
          font-size: 14px;
          font-weight: 700;
          color: #ffffff;
          box-shadow: 0 4px 20px rgba(79, 70, 229, 0.5);
        }
      </style>
      <div class="endcard-logo-box">
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <path d="m9 12 2 2 4-4"/>
        </svg>
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
  });

  await director.pause(7000);
}
