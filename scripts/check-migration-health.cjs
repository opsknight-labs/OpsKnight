/**
 * Migration Health Check Script
 *
 * Checks the health of Prisma migrations by comparing:
 * - Local migration files vs database migration table
 * - Detects failed migrations
 * - Identifies missing or extra migrations
 *
 * Usage: npm run prisma:health
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const REPORT_PATH = path.join(REPORTS_DIR, 'prisma-health.xml');

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

function writeJUnitReport({ success, warnings, errors }) {
  ensureReportsDir();

  const testName = 'prisma:health';
  const tests = 1;
  const failures = success ? 0 : 1;
  const systemOut = warnings.length ? warnings.join('\n') : '';
  const errorMessage = errors.length ? errors.join('\n') : '';

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${tests}" failures="${failures}" errors="0" skipped="0">`,
    `  <testsuite name="${testName}" tests="${tests}" failures="${failures}" errors="0" skipped="0">`,
    `    <testcase name="${testName}">`,
    success
      ? ''
      : `      <failure message="Migration health check failed">${escapeXml(errorMessage)}</failure>`,
    systemOut ? `      <system-out>${escapeXml(systemOut)}</system-out>` : '',
    '    </testcase>',
    '  </testsuite>',
    '</testsuites>',
  ]
    .filter(Boolean)
    .join('\n');

  fs.writeFileSync(REPORT_PATH, `${xml}\n`, 'utf8');
}

function getLocalMigrations() {
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

async function getDatabaseMigrations(prisma) {
  try {
    return await prisma.$queryRaw`
      SELECT migration_name, started_at, finished_at, logs
      FROM "_prisma_migrations"
      ORDER BY started_at ASC
    `;
  } catch (error) {
    console.error('Failed to query _prisma_migrations table');
    console.error('Make sure the database is accessible and migrations table exists');
    throw error;
  }
}

async function checkMigrationHealth() {
  console.log('Checking migration health...\n');

  const prisma = new PrismaClient();
  const warnings = [];
  const errors = [];

  try {
    const localMigrations = getLocalMigrations();
    const dbMigrations = await getDatabaseMigrations(prisma);

    const failedMigrations = dbMigrations.filter((m) => m.finished_at === null);
    if (failedMigrations.length > 0) {
      failedMigrations.forEach((migration) => {
        errors.push(
          `Failed migration: ${migration.migration_name} (started ${migration.started_at})`
        );
      });
    }

    const localMigrationSet = new Set(localMigrations);
    const extraInDb = dbMigrations
      .map((m) => m.migration_name)
      .filter((name) => !localMigrationSet.has(name));

    if (extraInDb.length > 0) {
      extraInDb.forEach((migration) => {
        errors.push(`Migration in DB but not locally: ${migration}`);
      });
    }

    const dbMigrationSet = new Set(dbMigrations.map((m) => m.migration_name));
    const notApplied = localMigrations.filter((name) => !dbMigrationSet.has(name));

    if (notApplied.length > 0) {
      notApplied.forEach((migration) => {
        warnings.push(`Unapplied migration: ${migration}`);
      });
    }

    console.log('SUMMARY:\n');
    console.log(`  Local migrations:      ${localMigrations.length}`);
    console.log(`  Database migrations:   ${dbMigrations.length}`);
    console.log(`  Failed migrations:     ${failedMigrations.length}`);
    console.log(`  Unapplied migrations:  ${notApplied.length}`);
    console.log(`  Extra in DB:           ${extraInDb.length}\n`);

    if (errors.length === 0 && notApplied.length === 0) {
      console.log('Migration health check passed!\n');
      writeJUnitReport({ success: true, warnings, errors });
      return true;
    }

    if (errors.length > 0) {
      console.log('Migration health check failed. Action required.\n');
      writeJUnitReport({ success: false, warnings, errors });
      return false;
    }

    console.log('Migration health check passed with warnings.\n');
    writeJUnitReport({ success: true, warnings, errors });
    return true;
  } catch (error) {
    errors.push(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    writeJUnitReport({ success: false, warnings, errors });
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

checkMigrationHealth()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
