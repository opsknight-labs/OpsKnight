import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

  it('defines one light and dark semantic component palette', () => {
    const styles = read('src/styles/index.css');
    expect(styles).toContain('--ui-background: 210 40% 98%');
    expect(styles).toContain('--ui-card: 0 0% 100%');
    expect(styles).toContain("[data-theme='dark']");
    expect(styles).toContain('--ui-background: 222.2 47.4% 7.5%');
    expect(styles).toContain('--ui-card: 222.2 47.4% 10.5%');
  });

  it('mirrors the resolved next-themes state for legacy data-theme selectors', () => {
    const providers = read('src/app/providers.tsx');
    expect(providers).toContain('const { resolvedTheme } = useTheme()');
    expect(providers).toContain('root.dataset.theme = effectiveTheme');
    expect(providers).toContain('root.style.colorScheme = effectiveTheme');
    expect(providers).toContain('enableColorScheme');
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
