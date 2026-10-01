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
      if (route.taskDocumentationRequired) {
        assert.ok(
          (route.documentation?.guides ?? []).length > 0,
          `${route.route}: interactive route requires a task guide; concepts and references are insufficient`
        );
      }
    }
    if (route.classification === 'HIDDEN') {
      assert.ok(!pages.some(page => /start\/|guides\//.test(page)), `${route.route}: hidden route is presented as generally available`);
    }
  }
});

test('high-risk configuration and mutation routes require task guides', () => {
  const required = [
    '/events/test',
    '/settings/incident-sla',
    '/settings/integrations/chatops',
    '/settings/privacy-requests',
    '/settings/status-pages',
    '/m',
    '/m/incidents',
  ];
  const routes = new Map(contract.routes.map(route => [route.route, route]));
  for (const path of required) {
    const route = routes.get(path);
    assert.ok(route, `${path}: missing from route contract`);
    assert.equal(route.taskDocumentationRequired, true, `${path}: must require task documentation`);
    assert.ok(route.documentation.guides.length > 0, `${path}: must map to a task guide`);
  }
});
