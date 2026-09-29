import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const contract = JSON.parse(readFileSync('generated/docs-contracts/routes.json', 'utf8'));
const publicClasses = new Set(['PUBLIC_FEATURE', 'ADMIN_FEATURE', 'OPERATOR_FEATURE']);

test('every UI route is explicitly classified and public surfaces have documentation', () => {
  assert.ok(contract.routes.length > 0);
  for (const route of contract.routes) {
    assert.ok(['PUBLIC_FEATURE', 'ADMIN_FEATURE', 'OPERATOR_FEATURE', 'HIDDEN', 'INTERNAL'].includes(route.classification), `${route.route}: unclassified`);
    const pages = Object.values(route.documentation ?? {}).flat();
    if (publicClasses.has(route.classification)) {
      assert.equal(route.documentationMapping, 'explicit-route-rule', `${route.route}: documentation is not route-specific`);
      assert.ok(pages.length > 0, `${route.route}: no documentation mapping`);
      for (const page of pages) assert.ok(existsSync(`docs/v2.0.0/${page}`), `${route.route}: missing ${page}`);
    }
    if (route.classification === 'HIDDEN') {
      assert.ok(!pages.some(page => /start\/|guides\//.test(page)), `${route.route}: hidden route is presented as generally available`);
    }
  }
});
