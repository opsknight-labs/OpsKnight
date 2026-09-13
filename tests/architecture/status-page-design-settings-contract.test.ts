import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('status page Design settings architecture', () => {
  it('keeps Design inside the existing settings workspace', () => {
    const workspace = read('src/components/status-page/StatusPageWorkspace.tsx');
    const config = read('src/components/StatusPageConfig.tsx');

    expect(workspace).toContain('<StatusPageConfig {...props} />');
    expect(workspace).not.toContain("type Workspace = 'settings' | 'design'");
    expect(workspace).not.toContain('StatusPageDesignSettings');

    const appearance = config.indexOf("id: 'appearance'");
    const design = config.indexOf("id: 'design'");
    const services = config.indexOf("id: 'services'");
    expect(appearance).toBeGreaterThan(-1);
    expect(design).toBeGreaterThan(appearance);
    expect(services).toBeGreaterThan(design);
    expect(config).toContain("activeSection === 'design'");
    expect(config).toContain('<StatusPageDesignSection');
  });

  it('uses one draft for Design, preview, and publication', () => {
    const config = read('src/components/StatusPageConfig.tsx');
    const sections = read('src/lib/status-pages/settings-sections.ts');

    expect(config).toContain('themeId: formData.themeId');
    expect(config).toContain('themeVersion: STATUS_PAGE_THEME_VERSION');
    expect(config).toContain('themeDensity: formData.themeDensity');
    expect(config).toContain('branding: previewBranding');
    expect(config).toContain('branding: brandingData');
    expect(sections).toContain("['design', ['branding']]");
  });

  it('keeps the shared V3 renderer authoritative for curated themes', () => {
    const page = read('src/components/status-page/StatusPageV3.tsx');
    const publicShell = read('src/components/status-page/StatusPageSnapshotView.tsx');
    const preview = read('src/components/status-page/StatusPageLivePreview.tsx');

    expect(page).toContain('compileStatusPageThemeCss');
    expect(page).toContain('resolveStatusPageThemeRuntimeVariables');
    expect(page).toContain('data-status-page-theme-runtime');
    expect(publicShell).toContain('<StatusPageV3');
    expect(preview).toContain('<StatusPageV3');
    expect(publicShell).not.toContain('compileStatusPageThemeCss');
  });

  it('keeps Default native while curated themes bridge runtime surface tokens', () => {
    const runtime = read('src/lib/status-pages/theme-runtime.ts');

    expect(runtime).toContain("if (theme.id === 'default') return {};");
    expect(runtime).toContain("'--status-panel-bg': preview.surface");
    expect(runtime).toContain("'--status-panel-muted-bg': preview.surfaceAlt");
    expect(runtime).toContain("'--status-text': preview.text");
    expect(runtime).toContain("'--status-primary': preview.accent");
  });
});
