import { logger } from '@/lib/logger';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';

type McpMaintenanceTask = 'credentials' | 'tasks';

/** The Prisma error code when there is one; never the message, which can carry SQL or values. */
function errorFacts(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
  return { name: error instanceof Error ? error.name : typeof error, ...(code ? { code } : {}) };
}

async function runTask<T>(task: McpMaintenanceTask, run: () => Promise<T>): Promise<T | null> {
  try {
    const result = await run();
    addOperationalMetric('opsknight_mcp_maintenance_runs_total', 1, { task, result: 'success' });
    return result;
  } catch (error) {
    addOperationalMetric('opsknight_mcp_maintenance_runs_total', 1, { task, result: 'failed' });
    logger.warn('[Cron] MCP maintenance failed', { task, ...errorFacts(error) });
    return null;
  }
}

/**
 * MCP retention: spent credentials and expired approvals, then expired tasks. Each runs on its own
 * so one failure cannot skip the other, and neither can block incident-response maintenance.
 * Failures are counted for the OpsKnightMcpMaintenance* alerts.
 */
export async function runMcpMaintenance() {
  const credentials = await runTask('credentials', async () => {
    const { cleanupMcpCredentials } = await import('./auth/retention');
    return cleanupMcpCredentials();
  });
  const tasks = await runTask('tasks', async () => {
    const { cleanupExpiredMcpTasks } = await import('./protocol/tasks');
    return cleanupExpiredMcpTasks();
  });
  return { credentials, tasks };
}
