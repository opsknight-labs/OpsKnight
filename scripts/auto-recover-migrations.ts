/**
 * Automatic Migration Recovery Script
 *
 * This script runs on application startup to detect and auto-resolve failed migrations.
 * Designed for containerized deployments where manual intervention is not possible.
 *
 * Features:
 * - Detects failed migrations
 * - Verifies actual database state
 * - Auto-resolves based on database reality
 * - Idempotent and safe for repeated runs
 * - No manual intervention required
 */

import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'child_process';
import { logger } from '../src/lib/logger';

const prisma = new PrismaClient();

type RecoveryMode = 'safe' | 'aggressive';

type ExecSyncError = Error & {
    status?: number | null;
    stdout?: Buffer | string;
    stderr?: Buffer | string;
};

interface MigrationRecord {
    migration_name: string;
    started_at: Date;
    finished_at: Date | null;
    logs: string | null;
}

interface RecoveryResult {
    success: boolean;
    action: 'resolved' | 'skipped' | 'failed';
    migration: string;
    reason: string;
}

function getRecoveryMode(): RecoveryMode {
    return process.env.MIGRATION_RECOVERY_MODE === 'aggressive' ? 'aggressive' : 'safe';
}

function bufferToString(value: Buffer | string | undefined) {
    if (typeof value === 'string') return value.trim();
    if (value) return value.toString('utf-8').trim();
    return undefined;
}

function formatExecError(error: unknown): string {
    if (error instanceof Error) {
        const execError = error as ExecSyncError;
        const stderr = bufferToString(execError.stderr);
        const stdout = bufferToString(execError.stdout);
        const details = [stderr, stdout].filter(Boolean).join(' | ');
        return details ? `${error.message}: ${details}` : error.message;
    }

    return String(error);
}

function runPrisma(args: string[]) {
    return execFileSync(
        process.execPath,
        ['node_modules/prisma/build/index.js', ...args],
        { stdio: 'pipe', encoding: 'utf-8' }
    );
}

/**
 * Check if enum value exists in database
 */
async function enumValueExists(enumName: string, value: string): Promise<boolean> {
    try {
        const result = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = ${enumName}
    `;
        return result.some(r => r.enumlabel === value);
    } catch (error) {
        logger.error('Failed to check enum value', { component: 'auto-recover-migrations', error, enumName, value });
        return false;
    }
}

/**
 * Get all failed migrations from database
 */
async function getFailedMigrations(): Promise<MigrationRecord[]> {
    try {
        const failed = await prisma.$queryRaw<MigrationRecord[]>`
      SELECT migration_name, started_at, finished_at, logs
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL
      ORDER BY started_at ASC
    `;
        return failed;
    } catch (error) {
        logger.error('Failed to query _prisma_migrations', { component: 'auto-recover-migrations', error });
        return [];
    }
}

/**
 * Auto-resolve a failed migration based on database state
 */
async function autoResolveMigration(migration: MigrationRecord): Promise<RecoveryResult> {
    const migrationName = migration.migration_name;
    const recoveryMode = getRecoveryMode();

    logger.info('Analyzing migration', { component: 'auto-recover-migrations', migration: migrationName });

    // Special handling for known enum migrations
    if (migrationName.includes('escalation_policy_enum')) {
        const exists = await enumValueExists('AuditEntityType', 'ESCALATION_POLICY');

        if (exists) {
            logger.info('Enum value exists in database', { component: 'auto-recover-migrations', migration: migrationName });
            logger.info('Resolving migration as applied', { component: 'auto-recover-migrations', migration: migrationName });

            try {
                runPrisma(['migrate', 'resolve', '--applied', migrationName]);

                return {
                    success: true,
                    action: 'resolved',
                    migration: migrationName,
                    reason: 'Enum value exists, marked as applied'
                };
            } catch (error) {
                return {
                    success: false,
                    action: 'failed',
                    migration: migrationName,
                    reason: `Failed to resolve: ${formatExecError(error)}`
                };
            }
        }

        logger.warn('Enum value missing, applying', { component: 'auto-recover-migrations', migration: migrationName });

        try {
            await prisma.$executeRaw`
          ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'ESCALATION_POLICY'
        `;

            runPrisma(['migrate', 'resolve', '--applied', migrationName]);

            return {
                success: true,
                action: 'resolved',
                migration: migrationName,
                reason: 'Enum value added and migration marked as applied'
            };
        } catch (error) {
            return {
                success: false,
                action: 'failed',
                migration: migrationName,
                reason: `Failed to apply enum: ${formatExecError(error)}`
            };
        }
    }

    // Generic handling for other migration types
    // For safety, we'll log and skip unknown failures
    logger.warn('Unknown migration type - manual review recommended', {
        component: 'auto-recover-migrations',
        migration: migrationName
    });

    if (recoveryMode === 'aggressive') {
        logger.warn('Aggressive recovery enabled, marking migration as rolled back', {
            component: 'auto-recover-migrations',
            migration: migrationName
        });
        try {
            runPrisma(['migrate', 'resolve', '--rolled-back', migrationName]);
            return {
                success: true,
                action: 'resolved',
                migration: migrationName,
                reason: 'Unknown migration marked as rolled back (aggressive mode)'
            };
        } catch (error) {
            return {
                success: false,
                action: 'failed',
                migration: migrationName,
                reason: `Failed to roll back: ${formatExecError(error)}`
            };
        }
    }

    return {
        success: false,
        action: 'skipped',
        migration: migrationName,
        reason: 'Unknown migration type, skipped for safety'
    };
}

/**
 * Main recovery function
 */
export async function autoRecoverMigrations(): Promise<boolean> {
    const recoveryMode = getRecoveryMode();
    logger.info('Starting automatic migration recovery', {
        component: 'auto-recover-migrations',
        mode: recoveryMode
    });

    let allSuccess = true;

    try {
        const failedMigrations = await getFailedMigrations();

        if (failedMigrations.length === 0) {
            logger.info('No failed migrations detected', { component: 'auto-recover-migrations' });
            return true;
        }

        logger.warn('Failed migrations detected', {
            component: 'auto-recover-migrations',
            count: failedMigrations.length
        });

        const results: RecoveryResult[] = [];

        for (const migration of failedMigrations) {
            const result = await autoResolveMigration(migration);
            results.push(result);

            if (result.action !== 'resolved') {
                allSuccess = false;
            }
        }

        const resolved = results.filter(r => r.action === 'resolved');
        const skipped = results.filter(r => r.action === 'skipped');
        const failed = results.filter(r => r.action === 'failed');

        if (resolved.length > 0) {
            logger.info('Resolved migrations', {
                component: 'auto-recover-migrations',
                migrations: resolved.map(r => ({ migration: r.migration, reason: r.reason }))
            });
        }

        if (skipped.length > 0) {
            logger.warn('Skipped migrations', {
                component: 'auto-recover-migrations',
                migrations: skipped.map(r => ({ migration: r.migration, reason: r.reason }))
            });
        }

        if (failed.length > 0) {
            logger.error('Failed migrations', {
                component: 'auto-recover-migrations',
                migrations: failed.map(r => ({ migration: r.migration, reason: r.reason }))
            });
        }

        if (allSuccess) {
            logger.info('All migrations recovered successfully', { component: 'auto-recover-migrations' });

            try {
                logger.info('Applying pending migrations', { component: 'auto-recover-migrations' });
                runPrisma(['migrate', 'deploy']);
            } catch (error) {
                logger.error('Failed to apply pending migrations', {
                    component: 'auto-recover-migrations',
                    error: formatExecError(error)
                });
                allSuccess = false;
            }
        }

        return allSuccess;

    } catch (error) {
        logger.error('Migration recovery failed', { component: 'auto-recover-migrations', error });
        return false;
    } finally {
        await prisma.$disconnect();
    }
}

// Run if called directly
if (typeof require !== 'undefined' && require.main === module) {
    autoRecoverMigrations()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            logger.error('Fatal migration recovery error', { component: 'auto-recover-migrations', error });
            process.exit(1);
        });
}
