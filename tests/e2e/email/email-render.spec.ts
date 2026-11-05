import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { expect, test, type Page } from '@playwright/test';
import { renderEmail } from '@/emails/render';

type TemplateModule = {
  default: ComponentType<Record<string, unknown>> & { PreviewProps?: Record<string, unknown> };
};

const TEMPLATE_DIR = join(process.cwd(), 'src/emails/templates');
const templates = readdirSync(TEMPLATE_DIR)
  .filter(file => file.endsWith('.tsx'))
  .map(file => basename(file, '.tsx'));
const LOGO = readFileSync(join(process.cwd(), 'public/images/email/opsknight-logo@2x.png'));

async function load(page: Page, name: string) {
  const mod = (await import(`@/emails/templates/${name}`)) as {
    default: TemplateModule['default'] | { default: TemplateModule['default'] };
  };
  // Playwright's CJS transform can double-wrap the default export.
  const Template = typeof mod.default === 'function' ? mod.default : mod.default.default;
  const { html } = await renderEmail(createElement(Template, Template.PreviewProps ?? {}));
  // Serve logos locally; block every other network request.
  await page.route('**/*', route =>
    /\.png($|\?)/.test(route.request().url())
      ? route.fulfill({ body: LOGO, contentType: 'image/png' })
      : route.abort()
  );
  await page.setContent(html, { waitUntil: 'load' });
}

/** WCAG contrast of an element's text against the nearest painted background. */
async function contrastOf(page: Page, selector: string): Promise<number[]> {
  return page.$$eval(selector, elements => {
    const parse = (value: string) => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = '1'] = m[1].split(',').map(part => part.trim());
      return Number(a) === 0 ? null : [Number(r), Number(g), Number(b)];
    };
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const lum = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    return elements
      .filter(el => (el as HTMLElement).offsetParent !== null && el.textContent?.trim())
      .map(el => {
        const fg = parse(getComputedStyle(el).color)!;
        let node: Element | null = el;
        let bg: number[] | null = null;
        while (node && !bg) {
          bg = parse(getComputedStyle(node).backgroundColor);
          node = node.parentElement;
        }
        const [hi, lo] = [lum(fg), lum(bg ?? [255, 255, 255])].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      });
  });
}

for (const name of templates) {
  test.describe(name, () => {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${scheme}: readable at desktop and mobile`, async ({ page }, info) => {
        await page.emulateMedia({ colorScheme: scheme });
        for (const width of [375, 640, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          await load(page, name);

          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth
          );
          expect(overflow, `${width}px horizontal overflow`).toBeLessThanOrEqual(1);

          for (const ratio of await contrastOf(page, 'h1'))
            expect(ratio, 'header title contrast').toBeGreaterThanOrEqual(3);
          for (const ratio of await contrastOf(page, 'a[style*="background-color"]'))
            expect(ratio, 'CTA contrast').toBeGreaterThanOrEqual(4.5);
          const bodyRatios = await contrastOf(page, '.dm-text-body, .dm-text-heading');
          expect(bodyRatios.length, 'body text measured').toBeGreaterThan(0);
          for (const ratio of bodyRatios)
            expect(ratio, 'body text contrast').toBeGreaterThanOrEqual(4.5);

          await page.screenshot({
            path: info.outputPath(`${name}-${scheme}-${width}.png`),
            fullPage: true,
          });
        }
      });
    }

    test('forced inversion (Gmail apps / Outlook Windows dark) screenshot', async ({ page }, info) => {
      await page.setViewportSize({ width: 640, height: 1000 });
      await load(page, name);
      await page.addStyleTag({ content: 'html{filter:invert(1) hue-rotate(180deg)}img{filter:invert(1) hue-rotate(180deg)}' });
      await page.screenshot({ path: info.outputPath(`${name}-forced-invert.png`), fullPage: true });
    });
  });
}
