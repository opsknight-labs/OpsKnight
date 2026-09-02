import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pagePath = path.resolve(__dirname, '../../src/app/(app)/settings/system/page.tsx');
const tabsPath = path.resolve(__dirname, '../../src/components/settings/SystemSettingsTabs.tsx');

describe('system settings redesign', () => {
  it('uses DetailHeroBanner with stat capsules and env badge', () => {
    const page = readFileSync(pagePath, 'utf8');

    // Centralized hero banner
    expect(page).toContain('DetailHeroBanner');
    expect(page).toContain('statsPlacement="bottom"');

    // Stat capsules — maps 1-to-1 to the 4 system settings tabs
    expect(page).toContain('App URL');
    expect(page).toContain('SSO / OIDC');
    expect(page).toContain('Data Retention');
    expect(page).toContain('Environment');

    // Encryption badge
    expect(page).toContain('Encryption Key Set');
    expect(page).toContain('Encryption Key Missing');
  });

  it('uses SystemSettingsTabs (DetailTabs) for section navigation', () => {
    const page = readFileSync(pagePath, 'utf8');
    const tabs = readFileSync(tabsPath, 'utf8');

    // Page delegates to SystemSettingsTabs
    expect(page).toContain('SystemSettingsTabs');

    // Tabs component uses DetailTabs
    expect(tabs).toContain('DetailTabs');

    // 4 tabs defined
    expect(tabs).toContain("id: 'app-url'");
    expect(tabs).toContain("id: 'sso'");
    expect(tabs).toContain("id: 'retention'");
    expect(tabs).toContain("id: 'environment'");

    // Health Center shortcut action button in tabs toolbar
    expect(tabs).toContain('/settings/system/health');
    expect(tabs).toContain('Health Center');
  });
});
