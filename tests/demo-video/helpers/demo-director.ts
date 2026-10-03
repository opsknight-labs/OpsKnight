import { type Page, type Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export interface Chapter {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  startTime: number; // in seconds
  endTime?: number;
  duration?: number;
}

export interface DemoDirectorOptions {
  recordChapters?: boolean;
  chaptersOutputPath?: string;
  cursorColor?: string;
}

export class DemoDirector {
  readonly page: Page;
  private currentX = 960;
  private currentY = 540;
  private startTime = 0;
  private chapters: Chapter[] = [];
  private currentChapter: Chapter | null = null;
  private chapterIndex = 0;
  private chaptersOutputPath: string;

  constructor(page: Page, options: DemoDirectorOptions = {}) {
    this.page = page;
    this.chaptersOutputPath =
      options.chaptersOutputPath ||
      path.resolve(process.cwd(), 'test-results/demo-video/chapters.json');
  }

  /**
   * Initializes the cinematic environment:
   * - Injects the virtual sleek glowing cursor
   * - Adds ripple click effect
   * - Hides ugly scrollbars
   * - Injects the glassmorphism chapter HUD badge
   */
  async init(): Promise<void> {
    this.startTime = Date.now();

    await this.page.addInitScript(() => {
      // Ensure dark theme
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('sidebarCollapsed', '0');

      const inject = () => {
        if (document.getElementById('demo-director-root')) return;
        const root = document.createElement('div');
        root.id = 'demo-director-root';
        root.innerHTML = `
        <style>
          *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
          * { scrollbar-width: none !important; -ms-overflow-style: none !important; }

          #demo-cursor {
            position: fixed;
            top: 0;
            left: 0;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: rgba(99, 102, 241, 0.45);
            border: 2px solid #818cf8;
            box-shadow: 0 0 16px rgba(129, 140, 248, 0.7), 0 0 4px rgba(255, 255, 255, 0.9);
            pointer-events: none;
            z-index: 2147483647;
            transform: translate(-50%, -50%);
            transition: width 0.15s cubic-bezier(0.16, 1, 0.3, 1),
                        height 0.15s cubic-bezier(0.16, 1, 0.3, 1),
                        background 0.15s ease,
                        box-shadow 0.15s ease;
          }
          #demo-cursor-dot {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: #ffffff;
            box-shadow: 0 0 6px #ffffff;
            transform: translate(-50%, -50%);
          }
          #demo-cursor.clicking {
            width: 15px;
            height: 15px;
            background: rgba(129, 140, 248, 0.9);
            box-shadow: 0 0 24px rgba(99, 102, 241, 1), 0 0 8px #ffffff;
          }

          .demo-click-ripple {
            position: fixed;
            border-radius: 50%;
            border: 2px solid #818cf8;
            pointer-events: none;
            z-index: 2147483646;
            transform: translate(-50%, -50%);
            animation: demo-ripple-anim 0.5s ease-out forwards;
          }
          @keyframes demo-ripple-anim {
            0% { width: 10px; height: 10px; opacity: 1; border-width: 2.5px; }
            100% { width: 60px; height: 60px; opacity: 0; border-width: 1px; }
          }

          #demo-chapter-hud {
            position: fixed;
            bottom: 28px;
            left: 28px;
            z-index: 2147483640;
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 10px 18px;
            background: rgba(15, 23, 42, 0.82);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 9999px;
            box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.6),
                        0 0 1px 1px rgba(255, 255, 255, 0.08);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #f8fafc;
            opacity: 0;
            transform: translateY(12px) scale(0.96);
            transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1),
                        transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
          }
          #demo-chapter-hud.visible {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          #demo-chapter-pill {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 3px 9px;
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            border-radius: 9999px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #ffffff;
            box-shadow: 0 2px 8px rgba(79, 70, 229, 0.4);
          }
          #demo-chapter-text {
            display: flex;
            flex-direction: column;
            gap: 1px;
          }
          #demo-chapter-title {
            font-size: 13.5px;
            font-weight: 700;
            letter-spacing: -0.01em;
            color: #ffffff;
            line-height: 1.2;
          }
          #demo-chapter-subtitle {
            font-size: 11.5px;
            font-weight: 500;
            color: #94a3b8;
            line-height: 1.2;
          }
        </style>
        <div id="demo-cursor" style="left: 960px; top: 540px;">
          <div id="demo-cursor-dot"></div>
        </div>
        <div id="demo-chapter-hud">
          <div id="demo-chapter-pill">01</div>
          <div id="demo-chapter-text">
            <div id="demo-chapter-title">OpsKnight</div>
            <div id="demo-chapter-subtitle">Incident Operations</div>
          </div>
        </div>
        `;
        if (document.body) {
          document.body.appendChild(root);
        } else {
          document.addEventListener('DOMContentLoaded', () => document.body?.appendChild(root));
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
      } else {
        inject();
      }
    });

    await this.injectOverlayStyles();
  }

  private async injectOverlayStyles(): Promise<void> {
    await this.page.evaluate(() => {
      // If already present, do nothing
      if (document.getElementById('demo-director-root')) return;

      const root = document.createElement('div');
      root.id = 'demo-director-root';
      root.innerHTML = `
        <style>
          /* Hide scrollbars everywhere for ultra clean recording */
          *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
          * { scrollbar-width: none !important; -ms-overflow-style: none !important; }

          /* Virtual Sleek Glowing Cursor */
          #demo-cursor {
            position: fixed;
            top: 0;
            left: 0;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: rgba(99, 102, 241, 0.45);
            border: 2px solid #818cf8;
            box-shadow: 0 0 16px rgba(129, 140, 248, 0.7), 0 0 4px rgba(255, 255, 255, 0.9);
            pointer-events: none;
            z-index: 2147483647;
            transform: translate(-50%, -50%);
            transition: width 0.15s cubic-bezier(0.16, 1, 0.3, 1),
                        height 0.15s cubic-bezier(0.16, 1, 0.3, 1),
                        background 0.15s ease,
                        box-shadow 0.15s ease;
          }
          #demo-cursor-dot {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: #ffffff;
            box-shadow: 0 0 6px #ffffff;
            transform: translate(-50%, -50%);
          }
          #demo-cursor.clicking {
            width: 15px;
            height: 15px;
            background: rgba(129, 140, 248, 0.9);
            box-shadow: 0 0 24px rgba(99, 102, 241, 1), 0 0 8px #ffffff;
          }

          /* Click Ripple */
          .demo-click-ripple {
            position: fixed;
            border-radius: 50%;
            border: 2px solid #818cf8;
            pointer-events: none;
            z-index: 2147483646;
            transform: translate(-50%, -50%);
            animation: demo-ripple-anim 0.5s ease-out forwards;
          }
          @keyframes demo-ripple-anim {
            0% { width: 10px; height: 10px; opacity: 1; border-width: 2.5px; }
            100% { width: 60px; height: 60px; opacity: 0; border-width: 1px; }
          }

          /* Cinematic Chapter HUD Badge */
          #demo-chapter-hud {
            position: fixed;
            bottom: 28px;
            left: 28px;
            z-index: 2147483640;
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 10px 18px;
            background: rgba(15, 23, 42, 0.82);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 9999px;
            box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.6),
                        0 0 1px 1px rgba(255, 255, 255, 0.08);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #f8fafc;
            opacity: 0;
            transform: translateY(12px) scale(0.96);
            transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1),
                        transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
          }
          #demo-chapter-hud.visible {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          #demo-chapter-pill {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 3px 9px;
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            border-radius: 9999px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #ffffff;
            box-shadow: 0 2px 8px rgba(79, 70, 229, 0.4);
          }
          #demo-chapter-text {
            display: flex;
            flex-direction: column;
            gap: 1px;
          }
          #demo-chapter-title {
            font-size: 13.5px;
            font-weight: 700;
            letter-spacing: -0.01em;
            color: #ffffff;
            line-height: 1.2;
          }
          #demo-chapter-subtitle {
            font-size: 11.5px;
            font-weight: 500;
            color: #94a3b8;
            line-height: 1.2;
          }
        </style>
        <div id="demo-cursor" style="left: 960px; top: 540px;">
          <div id="demo-cursor-dot"></div>
        </div>
        <div id="demo-chapter-hud">
          <div id="demo-chapter-pill">01</div>
          <div id="demo-chapter-text">
            <div id="demo-chapter-title">OpsKnight</div>
            <div id="demo-chapter-subtitle">Incident Operations</div>
          </div>
        </div>
      `;
      document.body.appendChild(root);
    });
  }

  /**
   * Set chapter with HUD display and track timestamps
   */
  async setChapter(title: string, subtitle: string, id?: string): Promise<void> {
    const elapsedSec = (Date.now() - this.startTime) / 1000;

    // Close previous chapter
    if (this.currentChapter) {
      this.currentChapter.endTime = elapsedSec;
      this.currentChapter.duration = this.currentChapter.endTime - this.currentChapter.startTime;
    }

    this.chapterIndex += 1;
    const chapterId = id || `chapter-${this.chapterIndex}`;

    this.currentChapter = {
      id: chapterId,
      number: this.chapterIndex,
      title,
      subtitle,
      startTime: elapsedSec,
    };
    this.chapters.push(this.currentChapter);

    await this.injectOverlayStyles();

    await this.page.evaluate(
      ({ num, t, st }) => {
        const hud = document.getElementById('demo-chapter-hud');
        const pill = document.getElementById('demo-chapter-pill');
        const titleEl = document.getElementById('demo-chapter-title');
        const subEl = document.getElementById('demo-chapter-subtitle');
        if (hud && pill && titleEl && subEl) {
          pill.textContent = num < 10 ? `0${num}` : `${num}`;
          titleEl.textContent = t;
          subEl.textContent = st;
          hud.classList.add('visible');
        }
      },
      { num: this.chapterIndex, t: title, st: subtitle }
    );
  }

  /**
   * Hide the chapter HUD
   */
  async hideChapterHud(): Promise<void> {
    await this.page.evaluate(() => {
      const hud = document.getElementById('demo-chapter-hud');
      if (hud) hud.classList.remove('visible');
    });
  }

  /**
   * Human-like smooth mouse movement to target coordinates or element with cubic bezier easing
   */
  async moveCursorTo(
    target: Locator | string | { x: number; y: number },
    options: { durationMs?: number; steps?: number; offsetX?: number; offsetY?: number } = {}
  ): Promise<void> {
    let toX = 960;
    let toY = 540;

    if (typeof target === 'object' && 'x' in target && 'y' in target) {
      toX = target.x;
      toY = target.y;
    } else {
      const locator = typeof target === 'string' ? this.page.locator(target).first() : target;
      try {
        const box = await locator.boundingBox({ timeout: 5000 });
        if (box) {
          toX = box.x + box.width / 2 + (options.offsetX || 0);
          toY = box.y + box.height / 2 + (options.offsetY || 0);
        }
      } catch {
        // Element not yet visible or offscreen, keep target coordinates
      }
    }

    const duration = options.durationMs || 500;
    const steps = options.steps || 25;
    const stepDuration = duration / steps;

    const fromX = this.currentX;
    const fromY = this.currentY;

    // Cubic bezier easing (ease-in-out curve) with subtle human deviation
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // Smooth easing formula: t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const easedT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      // Subtle arc deviation perpendicular to movement path
      const arc = Math.sin(t * Math.PI) * 12 * (i % 2 === 0 ? 1 : -0.5);

      const curX = fromX + (toX - fromX) * easedT + arc;
      const curY = fromY + (toY - fromY) * easedT;

      await this.page.mouse.move(curX, curY);

      // Update on-screen virtual cursor
      await this.page.evaluate(
        ({ x, y }) => {
          const cursor = document.getElementById('demo-cursor');
          if (cursor) {
            cursor.style.left = `${x}px`;
            cursor.style.top = `${y}px`;
          }
        },
        { x: curX, y: curY }
      );

      await this.page.waitForTimeout(stepDuration);
    }

    this.currentX = toX;
    this.currentY = toY;
  }

  /**
   * Naturally click an element with realistic pause, visual ripple, and release
   */
  async clickNaturally(
    target: Locator | string,
    options: { delayBeforeMs?: number; holdMs?: number; delayAfterMs?: number } = {}
  ): Promise<void> {
    const locator = typeof target === 'string' ? this.page.locator(target).first() : target;

    await this.moveCursorTo(locator, { durationMs: 450 });
    await this.page.waitForTimeout(options.delayBeforeMs || 220);

    // Visual click press & ripple
    await this.page.evaluate(
      ({ x, y }) => {
        const cursor = document.getElementById('demo-cursor');
        if (cursor) cursor.classList.add('clicking');

        const ripple = document.createElement('div');
        ripple.className = 'demo-click-ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      },
      { x: this.currentX, y: this.currentY }
    );

    await this.page.mouse.down();
    await this.page.waitForTimeout(options.holdMs || 80);
    await this.page.mouse.up();

    try {
      await locator.click({ timeout: 2000, force: true });
    } catch {
      // Element might have been triggered by mouse click
    }

    await this.page.evaluate(() => {
      const cursor = document.getElementById('demo-cursor');
      if (cursor) cursor.classList.remove('clicking');
    });

    await this.page.waitForTimeout(options.delayAfterMs || 350);
  }

  /**
   * Hover over an element and wait to reveal tooltips or card hover effects
   */
  async hover(target: Locator | string, hoverMs: number = 800): Promise<void> {
    const locator = typeof target === 'string' ? this.page.locator(target).first() : target;
    await this.moveCursorTo(locator, { durationMs: 400 });
    try {
      await locator.hover({ timeout: 2000 });
    } catch {
      // ignore
    }
    await this.page.waitForTimeout(hoverMs);
  }

  /**
   * Smooth stepped scroll down or to a target position
   */
  async scrollSlowly(targetScrollY: number, durationMs: number = 900): Promise<void> {
    const currentScrollY = await this.page.evaluate(() => window.scrollY);
    const distance = targetScrollY - currentScrollY;
    const steps = 30;
    const stepDuration = durationMs / steps;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const easedT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const nextY = currentScrollY + distance * easedT;

      await this.page.evaluate(y => window.scrollTo(0, y), nextY);
      await this.page.waitForTimeout(stepDuration);
    }
  }

  /**
   * Pause for duration
   */
  async pause(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /**
   * Cinematic pause for viewer to take in the UI
   */
  async cinematicPause(ms: number = 1200): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /**
   * Finalize recording and write chapters.json
   */
  async finalize(): Promise<void> {
    const elapsedSec = (Date.now() - this.startTime) / 1000;
    if (this.currentChapter) {
      this.currentChapter.endTime = elapsedSec;
      this.currentChapter.duration = this.currentChapter.endTime - this.currentChapter.startTime;
    }

    try {
      const dir = path.dirname(this.chaptersOutputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.chaptersOutputPath,
        JSON.stringify(
          {
            totalDuration: elapsedSec,
            chapters: this.chapters,
            generatedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );
      console.log(`[DemoDirector] Chapters written to: ${this.chaptersOutputPath}`);
    } catch (err) {
      console.error('[DemoDirector] Failed to write chapters:', err);
    }
  }
}
