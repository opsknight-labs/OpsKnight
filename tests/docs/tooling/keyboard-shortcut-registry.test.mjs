import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const registry = readFileSync('src/lib/keyboard-shortcuts.ts', 'utf8');
const handler = readFileSync('src/components/GlobalKeyboardHandler.tsx', 'utf8');
const popup = readFileSync('src/components/KeyboardShortcuts.tsx', 'utf8');
const page = readFileSync('src/app/(app)/shortcuts/page.tsx', 'utf8');

test('runtime, popup, and shortcut page share the canonical registry', () => {
  assert.match(handler, /GLOBAL_NAVIGATION_SHORTCUTS/);
  assert.match(popup, /KEYBOARD_SHORTCUTS.*keyboard-shortcuts/s);
  assert.match(page, /KEYBOARD_SHORTCUTS.*keyboard-shortcuts/s);
  for (const unsupported of ['Save current form', 'Go to Workspace', 'Export CSV report']) {
    assert.ok(!registry.includes(unsupported), `canonical registry advertises unsupported action: ${unsupported}`);
  }
});
