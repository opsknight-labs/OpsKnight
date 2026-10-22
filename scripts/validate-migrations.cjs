/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS CLI/test runs before application compilation. */
/* eslint-disable security/detect-non-literal-fs-filename -- Paths are fixed repository migration/report inventory, never request input. */
/**
 * Migration Validation Script
 *
 * Validates Prisma migrations before deployment to catch common issues:
 * - Transaction-unsafe enum additions
 * - Dangerous operations (DROP, TRUNCATE)
 * - Invalid migration naming
 * - Syntax errors
 *
 * Usage: npm run prisma:validate
 */

const fs = require('fs');
const path = require('path');
const { createHash } = require('node:crypto');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const REPORT_PATH = path.join(REPORTS_DIR, 'prisma-validate.xml');
const DANGEROUS_OPERATIONS = ['DROP TABLE', 'DROP COLUMN', 'TRUNCATE', 'DELETE FROM'];
const ENUM_ALTER_PATTERN = /ALTER\s+TYPE\s+"?\w+"?\s+ADD\s+VALUE/i;
// Some legacy migrations predate stricter safety checks and are allowed to violate them.
// Avoid editing historical migrations that may have been applied in production.
const DROP_WITHOUT_IF_EXISTS_ALLOWLIST = new Set(['20260104135828_remove_nextauth_adapter_tables']);

// These exact migration bytes have already been applied by SSO preview installations.
// Preserve Prisma checksums. Exceptions cover only the reviewed rule, never future SQL
// under the same name or new migrations. Any byte change restores the strict error.
const REVIEWED_APPLIED_MIGRATIONS = new Map([
  [
    '20261020110000_dashboard_api_revision',
    {
      sha256: '49594429ed7c9e61db0a80030dda198796abe25b56d2b755de9eb182191c8fb6',
      rule: 'ENUM_MIXED_OPERATIONS',
      reason:
        'Already-applied dashboard migration: revision-column and trigger DDL never references the new DASHBOARD audit enum value; preserve deployed Prisma checksums.',
    },
  ],
  [
    '20261020111000_saved_report_definitions',
    {
      sha256: '50f4d7bb64fae0036e502a04b35f6931cc504bf1f9ca84d998343a65a59f905e',
      rule: 'ENUM_MIXED_OPERATIONS',
      reason:
        'Already-applied saved-report migration: table/index/trigger DDL never references the new SAVED_REPORT audit enum value; preserve deployed Prisma checksums.',
    },
  ],
  [
    '20261012140000_enterprise_authentication',
    {
      sha256: '776e112c24d76b573bb589ba2779e4a7a09160aa9126a2f2d7b157bf457c0dcb',
      rule: 'ENUM_MIXED_OPERATIONS',
      reason:
        'Already-applied SSO migration: unrelated table DDL never uses the new SECURITY enum value before commit; clean and published-release PostgreSQL upgrades are certified.',
    },
  ],
  [
    '20261013180000_authentication_alert_terminal',
    {
      sha256: '75aa0d9387c4e4912d765f6e0f6934513fda5a9400949a31c0160150343feffe',
      rule: 'DROP_WITHOUT_IF_EXISTS',
      reason:
        'Already-applied SSO migration drops the exact predecessor index created by the preceding schema.',
    },
  ],
  [
    '20261013200000_authentication_alert_failure',
    {
      sha256: 'db26a10f4e85e93811c90d0681bd2924e98b774c94ad49c4a607b677701d7c5e',
      rule: 'DROP_WITHOUT_IF_EXISTS',
      reason: 'Already-applied SSO migration replaces its exact predecessor alert index.',
    },
  ],
  [
    '20261014120000_authentication_alert_receipts',
    {
      sha256: 'd39deab277f26670b234897ecc72d8ce08edf9a3753ac3aaafb69638ab8d87fb',
      rule: 'DROP_WITHOUT_IF_EXISTS',
      reason:
        'Already-applied SSO migration replaces its exact predecessor alert index while preserving receipt history.',
    },
  ],
]);

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function writeJUnitReport({ success, errors, warnings, infos }) {
  ensureReportsDir();

  const testName = 'prisma:validate';
  const tests = 1;
  const failures = success ? 0 : 1;
  const errorMessages = errors.length
    ? errors.map(issue => `[${issue.migration}] ${issue.message}`).join('\n')
    : '';
  const warningMessages = warnings.length
    ? warnings.map(issue => `[${issue.migration}] ${issue.message}`).join('\n')
    : '';
  const infoMessages = infos.length
    ? infos.map(issue => `[${issue.migration}] ${issue.message}`).join('\n')
    : '';

  const systemOut = [warningMessages, infoMessages].filter(Boolean).join('\n');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${tests}" failures="${failures}" errors="0" skipped="0">`,
    `  <testsuite name="${testName}" tests="${tests}" failures="${failures}" errors="0" skipped="0">`,
    `    <testcase name="${testName}">`,
    success
      ? ''
      : `      <failure message="Migration validation failed">${escapeXml(errorMessages)}</failure>`,
    systemOut ? `      <system-out>${escapeXml(systemOut)}</system-out>` : '',
    '    </testcase>',
    '  </testsuite>',
    '</testsuites>',
  ]
    .filter(Boolean)
    .join('\n');

  fs.writeFileSync(REPORT_PATH, `${xml}\n`, 'utf8');
}

function getAllMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error('Migrations directory not found');
    process.exit(1);
  }

  const entries = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map(entry => entry.name)
    .sort();
}

function readMigrationSQL(migrationName) {
  const sqlPath = path.join(MIGRATIONS_DIR, migrationName, 'migration.sql');

  if (!fs.existsSync(sqlPath)) {
    return null;
  }

  return fs.readFileSync(sqlPath, 'utf-8');
}

function validateMigrationNaming(migrationName) {
  const timestampPattern = /^(\d{14})_(.+)$/;
  const match = migrationName.match(timestampPattern);

  if (!match) {
    return {
      severity: 'error',
      migration: migrationName,
      message: 'Invalid migration name format. Expected: YYYYMMDDHHmmss_description',
    };
  }

  const [, timestamp, description] = match;
  const month = parseInt(timestamp.substring(4, 6), 10);
  const day = parseInt(timestamp.substring(6, 8), 10);

  if (month < 1 || month > 12) {
    return {
      severity: 'error',
      migration: migrationName,
      message: `Invalid month in timestamp: ${month}`,
    };
  }

  if (day < 1 || day > 31) {
    return {
      severity: 'error',
      migration: migrationName,
      message: `Invalid day in timestamp: ${day}`,
    };
  }

  const monthsWith30Days = [4, 6, 9, 11];
  if (monthsWith30Days.includes(month) && day > 30) {
    return {
      severity: 'error',
      migration: migrationName,
      message: `Invalid date: Month ${month} only has 30 days, found day ${day}`,
    };
  }

  if (month === 2 && day > 29) {
    return {
      severity: 'error',
      migration: migrationName,
      message: `Invalid date: February cannot have ${day} days`,
    };
  }

  if (!description || description.length < 3) {
    return {
      severity: 'warning',
      migration: migrationName,
      message: 'Migration description is too short or missing',
    };
  }

  return null;
}

function validateMigrationContent(migrationName, sql) {
  const issues = [];

  if (ENUM_ALTER_PATTERN.test(sql)) {
    const lines = sql.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('--');
    });

    if (lines.length > 1) {
      const hasOtherOperations = lines.some(line => {
        const trimmed = line.trim();
        return trimmed && !ENUM_ALTER_PATTERN.test(trimmed) && trimmed !== ';';
      });

      if (hasOtherOperations) {
        issues.push({
          severity: 'error',
          rule: 'ENUM_MIXED_OPERATIONS',
          migration: migrationName,
          message:
            'CRITICAL: Enum ALTER TYPE cannot be mixed with other operations. Split this into separate migrations.',
        });
      }
    }

    issues.push({
      severity: 'warning',
      migration: migrationName,
      message: 'Contains enum value addition. Ensure this migration ONLY contains enum changes.',
    });
  }

  for (const operation of DANGEROUS_OPERATIONS) {
    if (sql.toUpperCase().includes(operation)) {
      issues.push({
        severity: 'warning',
        migration: migrationName,
        message: `Contains potentially dangerous operation: ${operation}. Ensure backups exist.`,
      });
    }
  }

  const hasDrop = /DROP\s+(TABLE|INDEX|COLUMN|TYPE)/i.test(sql);
  const hasIfExists = /IF\s+EXISTS/i.test(sql);
  if (hasDrop && !hasIfExists) {
    const severity = DROP_WITHOUT_IF_EXISTS_ALLOWLIST.has(migrationName) ? 'warning' : 'error';
    issues.push({
      severity,
      rule: 'DROP_WITHOUT_IF_EXISTS',
      migration: migrationName,
      message:
        'DROP operation without IF EXISTS clause. Use IF EXISTS for safer deploys (or add to allowlist only for legacy migrations).',
    });
  }

  const reviewed = REVIEWED_APPLIED_MIGRATIONS.get(migrationName);
  if (reviewed && createHash('sha256').update(sql).digest('hex') === reviewed.sha256) {
    return issues.map(issue =>
      issue.severity === 'error' && issue.rule === reviewed.rule
        ? { ...issue, severity: 'info', message: `Reviewed applied migration: ${reviewed.reason}` }
        : issue
    );
  }
  return issues;
}

function validateMigrations() {
  console.log('Validating Prisma migrations...\n');

  const migrations = getAllMigrations();
  const issues = [];

  for (const migration of migrations) {
    const namingIssue = validateMigrationNaming(migration);
    if (namingIssue) {
      issues.push(namingIssue);
    }

    const sql = readMigrationSQL(migration);
    if (!sql) {
      issues.push({
        severity: 'error',
        migration,
        message: 'migration.sql file not found',
      });
      continue;
    }

    const contentIssues = validateMigrationContent(migration, sql);
    issues.push(...contentIssues);
  }

  const errors = issues.filter(issue => issue.severity === 'error');
  const warnings = issues.filter(issue => issue.severity === 'warning');
  const infos = issues.filter(issue => issue.severity === 'info');

  if (errors.length > 0) {
    console.log('ERRORS:\n');
    errors.forEach(issue => {
      console.log(`  ${issue.migration}`);
      console.log(`  - ${issue.message}\n`);
    });
  }

  if (warnings.length > 0) {
    console.log('WARNINGS:\n');
    warnings.forEach(issue => {
      console.log(`  ${issue.migration}`);
      console.log(`  - ${issue.message}\n`);
    });
  }

  if (infos.length > 0) {
    console.log('INFO:\n');
    infos.forEach(issue => {
      console.log(`  ${issue.migration}`);
      console.log(`  - ${issue.message}\n`);
    });
  }

  if (issues.length === 0) {
    console.log('All migrations validated successfully!\n');
    writeJUnitReport({ success: true, errors, warnings, infos });
    return true;
  }

  console.log(
    `\nSummary: ${errors.length} errors, ${warnings.length} warnings, ${infos.length} info`
  );

  if (errors.length > 0) {
    console.log('\nValidation failed. Fix errors before deploying.');
    writeJUnitReport({ success: false, errors, warnings, infos });
    return false;
  }

  console.log('\nValidation passed with warnings. Review warnings before deploying.');
  writeJUnitReport({ success: true, errors, warnings, infos });
  return true;
}

if (require.main === module) {
  const success = validateMigrations();
  process.exit(success ? 0 : 1);
}
module.exports = { validateMigrationContent };
