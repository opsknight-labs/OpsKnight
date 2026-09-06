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

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const REPORT_PATH = path.join(REPORTS_DIR, 'prisma-validate.xml');
const DANGEROUS_OPERATIONS = ['DROP TABLE', 'DROP COLUMN', 'TRUNCATE', 'DELETE FROM'];
const ENUM_ALTER_PATTERN = /ALTER\s+TYPE\s+"?\w+"?\s+ADD\s+VALUE/i;
// Some legacy migrations predate stricter safety checks and are allowed to violate them.
// Avoid editing historical migrations that may have been applied in production.
const DROP_WITHOUT_IF_EXISTS_ALLOWLIST = new Set([
  '20260104135828_remove_nextauth_adapter_tables',
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
    ? errors.map((issue) => `[${issue.migration}] ${issue.message}`).join('\n')
    : '';
  const warningMessages = warnings.length
    ? warnings.map((issue) => `[${issue.migration}] ${issue.message}`).join('\n')
    : '';
  const infoMessages = infos.length
    ? infos.map((issue) => `[${issue.migration}] ${issue.message}`).join('\n')
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
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name)
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
    const lines = sql.split('\n').filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('--');
    });

    if (lines.length > 1) {
      const hasOtherOperations = lines.some((line) => {
        const trimmed = line.trim();
        return trimmed && !ENUM_ALTER_PATTERN.test(trimmed) && trimmed !== ';';
      });

      if (hasOtherOperations) {
        issues.push({
          severity: 'error',
          migration: migrationName,
          message:
            'CRITICAL: Enum ALTER TYPE cannot be mixed with other operations. Split this into separate migrations.',
        });
      }
    }

    issues.push({
      severity: 'warning',
      migration: migrationName,
      message:
        'Contains enum value addition. Ensure this migration ONLY contains enum changes.',
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
      migration: migrationName,
      message:
        'DROP operation without IF EXISTS clause. Use IF EXISTS for safer deploys (or add to allowlist only for legacy migrations).',
    });
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

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const infos = issues.filter((issue) => issue.severity === 'info');

  if (errors.length > 0) {
    console.log('ERRORS:\n');
    errors.forEach((issue) => {
      console.log(`  ${issue.migration}`);
      console.log(`  - ${issue.message}\n`);
    });
  }

  if (warnings.length > 0) {
    console.log('WARNINGS:\n');
    warnings.forEach((issue) => {
      console.log(`  ${issue.migration}`);
      console.log(`  - ${issue.message}\n`);
    });
  }

  if (infos.length > 0) {
    console.log('INFO:\n');
    infos.forEach((issue) => {
      console.log(`  ${issue.migration}`);
      console.log(`  - ${issue.message}\n`);
    });
  }

  if (issues.length === 0) {
    console.log('All migrations validated successfully!\n');
    writeJUnitReport({ success: true, errors, warnings, infos });
    return true;
  }

  console.log(`\nSummary: ${errors.length} errors, ${warnings.length} warnings, ${infos.length} info`);

  if (errors.length > 0) {
    console.log('\nValidation failed. Fix errors before deploying.');
    writeJUnitReport({ success: false, errors, warnings, infos });
    return false;
  }

  console.log('\nValidation passed with warnings. Review warnings before deploying.');
  writeJUnitReport({ success: true, errors, warnings, infos });
  return true;
}

const success = validateMigrations();
process.exit(success ? 0 : 1);
