'use server';

import { z } from 'zod/v3';
import { logAudit } from '@/lib/audit';
import { loadMcpViewer } from './queries';
import { USAGE_WINDOW_KEYS, getMcpUsageExportRows, usageToCsv } from './usage';

const exportInput = z
  .object({
    window: z.enum(USAGE_WINDOW_KEYS),
    q: z.string().max(100).optional(),
    format: z.enum(['csv', 'json']),
  })
  .strict();

export type McpUsageExportResult = {
  filename: string;
  mimeType: string;
  content: string;
  rows: number;
  /** More rows matched than one export holds. */
  truncated: boolean;
};

/**
 * The call-log rows behind the Usage view as CSV or JSON. Administrators only, bounded, and itself
 * audited (who exported what window), because the log names clients and people.
 */
export async function exportMcpUsage(input: unknown): Promise<McpUsageExportResult> {
  const parsed = exportInput.parse(input);
  const viewer = await loadMcpViewer();
  const { rows, truncated } = await getMcpUsageExportRows(viewer, {
    window: parsed.window,
    q: parsed.q,
  });
  await logAudit({
    source: 'UI',
    action: 'mcp.usage.exported',
    entityType: 'SYSTEM_CONFIG',
    actorId: viewer.id,
    details: { window: parsed.window, filtered: Boolean(parsed.q), rows: rows.length, truncated },
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    filename: `opsknight-mcp-usage-${parsed.window}-${stamp}.${parsed.format}`,
    mimeType: parsed.format === 'csv' ? 'text/csv' : 'application/json',
    content: parsed.format === 'csv' ? usageToCsv(rows) : JSON.stringify(rows, null, 2),
    rows: rows.length,
    truncated,
  };
}
