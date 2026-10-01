import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mobile icon asset contract', () => {
  it('derives every install icon from the official OpsKnight logo on the product background', () => {
    const route = readFileSync('src/app/icons/[asset]/route.ts', 'utf8');

    expect(route).toContain("join(process.cwd(), 'public', 'logo.png')");
    expect(route).toContain("const ICON_BACKGROUND = '#0f172a'");
    expect(route).toContain("alignItems: 'center'");
    expect(route).toContain("justifyContent: 'center'");
    expect(route).toContain("['opsknight-apple-touch.png', { size: 180");
    expect(route).toContain("['opsknight-maskable-512.png', { size: 512");
  });

  it('does not keep stale hand-generated icon PNGs that can drift from the official logo', () => {
    expect(existsSync('public/icons/app-icon-192.png')).toBe(false);
    expect(existsSync('public/icons/app-icon-512.png')).toBe(false);
    expect(existsSync('public/icons/app-icon-maskable-192.png')).toBe(false);
    expect(existsSync('public/icons/app-icon-maskable-512.png')).toBe(false);
    expect(existsSync('public/icons/apple-touch-icon.png')).toBe(false);
  });

  it('uses cache-busting canonical icon names while keeping legacy URL aliases', () => {
    const manifest = readFileSync('src/app/manifest.ts', 'utf8');
    const layout = readFileSync('src/app/layout.tsx', 'utf8');
    const route = readFileSync('src/app/icons/[asset]/route.ts', 'utf8');

    expect(manifest).toContain('/icons/opsknight-192.png');
    expect(manifest).toContain('/icons/opsknight-512.png');
    expect(manifest).toContain('/icons/opsknight-maskable-192.png');
    expect(manifest).toContain('/icons/opsknight-maskable-512.png');
    expect(layout).toContain('/icons/opsknight-apple-touch.png');

    expect(route).toContain("['app-icon-192.png',");
    expect(route).toContain("['apple-touch-icon.png',");
  });
});
