/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS CLI/test runs before application compilation. */
/* eslint-disable security/detect-non-literal-fs-filename -- Paths are fixed repository migration/report inventory, never request input. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { validateMigrationContent } = require('../../scripts/validate-migrations.cjs');

const reviewed = [
  '20261012140000_enterprise_authentication',
  '20261013180000_authentication_alert_terminal',
  '20261013200000_authentication_alert_failure',
  '20261014120000_authentication_alert_receipts',
];
for (const name of reviewed) {
  test(`${name}: only immutable reviewed bytes receive the scoped exception`, () => {
    const sql = readFileSync(
      join(__dirname, '../../prisma/migrations', name, 'migration.sql'),
      'utf8'
    );
    assert.equal(
      validateMigrationContent(name, sql).some(issue => issue.severity === 'error'),
      false
    );
    assert.equal(
      validateMigrationContent(name, sql).filter(issue => issue.severity === 'info').length,
      1
    );
    assert.equal(
      validateMigrationContent(name, sql + '\n-- changed SQL').some(
        issue => issue.severity === 'error'
      ),
      true
    );
    assert.equal(
      validateMigrationContent('20261015120000_new_migration', sql).some(
        issue => issue.severity === 'error'
      ),
      true
    );
  });
}
test('new unsafe enum mixtures and unguarded drops still fail validation', () => {
  assert.ok(
    validateMigrationContent(
      '20261015120000_new_migration',
      'ALTER TYPE "Example" ADD VALUE \'NEW\';\nCREATE TABLE "ExampleTable" (id TEXT);'
    ).some(issue => issue.severity === 'error')
  );
  assert.ok(
    validateMigrationContent('20261015120000_new_migration', 'DROP INDEX "important";').some(
      issue => issue.severity === 'error'
    )
  );
});
