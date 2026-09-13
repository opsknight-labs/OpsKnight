import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { statusPageSectionFields } from '@/lib/status-pages/settings-sections';

describe('status page design settings & styling contracts', () => {
  it('registers design in settings sections with branding field', () => {
    const fields = statusPageSectionFields('design');
    expect(fields).not.toBeNull();
    expect(fields?.has('branding')).toBe(true);
    expect(fields?.has('id')).toBe(true);
    expect(fields?.has('expectedUpdatedAt')).toBe(true);
  });

  it('does not globally force cards to light colors from the browser dark preference', () => {
    const cardsCss = readFileSync('src/styles/components/cards.css', 'utf8');
    expect(cardsCss).not.toContain('@media (prefers-color-scheme: dark)');
    expect(cardsCss).not.toContain('[class*="card"]');
  });

  it('ensures status tokens in public-css have no circular variable references', () => {
    const publicCss = readFileSync('src/lib/status-pages/public-css.ts', 'utf8');
    expect(publicCss).not.toContain(
      '--status-panel-border: var(--sp-panel-border, var(--status-panel-border'
    );
    expect(publicCss).not.toContain('--status-panel-bg: var(--sp-panel-bg, var(--status-panel-bg');
    expect(publicCss).not.toContain('--status-text: var(--sp-ink, var(--status-text');
  });

  it('gives badges and cards visible non-transparent borders on status pages', () => {
    const publicCss = readFileSync('src/lib/status-pages/public-css.ts', 'utf8');
    expect(publicCss).not.toContain('border: 1px solid transparent !important');
    expect(publicCss).toContain('.status-badge');
    expect(publicCss).toContain('[data-badge="true"]');
  });

  it('renders StatusPageConfig directly in StatusPageWorkspace without separate tabs', () => {
    const workspace = readFileSync('src/components/status-page/StatusPageWorkspace.tsx', 'utf8');
    expect(workspace).not.toContain("workspace === 'design'");
    expect(workspace).toContain('<StatusPageConfig {...props} />');
  });
});
