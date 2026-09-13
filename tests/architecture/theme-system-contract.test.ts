import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line security/detect-non-literal-fs-filename
const read = (path: string) => readFileSync(path, 'utf8');

describe('application theme contract', () => {
  it('keeps Tailwind/shadcn semantic colors isolated from legacy CSS variables', () => {
    const config = read('tailwind.config.ts');
    expect(config).toContain("background: 'hsl(var(--ui-background)");
    expect(config).toContain("foreground: 'hsl(var(--ui-foreground)");
    expect(config).toContain("border: 'hsl(var(--ui-border)");
    expect(config).toContain("DEFAULT: 'hsl(var(--ui-card)");
    expect(config).not.toContain("background: 'hsl(var(--background)");
  });

  it('defines one light palette and the neutral OpsKnight dark palette', () => {
    const styles = read('src/styles/index.css');
    expect(styles).toContain('--ui-background: 210 40% 98%');
    expect(styles).toContain('--ui-card: 0 0% 100%');
    expect(styles).toContain("[data-theme='dark']");
    expect(styles).toContain('--ui-background: 240 10% 3.9%');
    expect(styles).toContain('--ui-card: 240 5.9% 7.5%');
    expect(styles).toContain('--ui-accent: 240 3.7% 15.9%');
  });

  it('makes mobile chrome consume only the canonical semantic palette', () => {
    const shell = read('src/app/(mobile)/m/mobile-shell.css');
    expect(shell).toContain('background: hsl(var(--ui-background))');
    expect(shell).toContain('background: hsl(var(--ui-card) / 0.98)');
    expect(shell).toContain('outline: 2px solid hsl(var(--ui-ring))');
    expect(shell).not.toContain('--background:');
    expect(shell).not.toContain('--card:');
    expect(shell).not.toContain('hsl(var(--background))');
    expect(shell).not.toContain('hsl(var(--border))');
  });

  it('anchors navigation outside the mobile content scroll flow', () => {
    const shell = read('src/app/(mobile)/m/mobile-shell.css');
    expect(shell).toContain('position: fixed;\n  inset: 0;');
    expect(shell).toContain('grid-template-rows: auto minmax(0, 1fr) auto;');
    expect(shell).toContain('grid-row: 2;');
    expect(shell).toContain('overflow-y: auto;');
    expect(shell).toContain('grid-row: 3;');
  });

  it('mirrors the resolved next-themes state for legacy selectors and browser chrome', () => {
    const providers = read('src/app/providers.tsx');
    expect(providers).toContain('const { resolvedTheme } = useTheme()');
    expect(providers).toContain('root.dataset.theme = effectiveTheme');
    expect(providers).toContain('root.style.colorScheme = effectiveTheme');
    expect(providers).toContain('meta[name="theme-color"]');
    expect(providers).toContain('enableColorScheme');
  });

  it('lets the pre-hydration dark class drive legacy compatibility variables', () => {
    const legacyDark = read('src/styles/foundation/variables-dark.css');
    expect(legacyDark).toContain('.dark,');
    expect(legacyDark).toContain("[data-theme='dark']");
    expect(legacyDark).toContain('.dark .mobile-shell');
  });

  it('does not let OS dark preference force application components back to light', () => {
    const files = [
      'src/styles/foundation/base.css',
      'src/styles/components/cards.css',
      'src/styles/components/forms.css',
      'src/styles/components/buttons.css',
      'src/styles/components/modals.css',
      'src/styles/components/dropdowns.css',
      'src/styles/components/tables.css',
      'src/styles/components/badges.css',
    ];

    for (const file of files) {
      expect(read(file), file).not.toContain('@media (prefers-color-scheme: dark)');
    }
  });
});
