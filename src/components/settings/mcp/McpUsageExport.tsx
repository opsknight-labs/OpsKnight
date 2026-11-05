'use client';

import { useState, useTransition } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import type { McpUsageExportResult } from '@/app/(app)/settings/integrations/mcp/usage-actions';

type Props = {
  window: string;
  q: string;
  exportAction: (input: unknown) => Promise<McpUsageExportResult>;
};

function download(result: McpUsageExportResult) {
  const url = URL.createObjectURL(new Blob([result.content], { type: result.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Downloads the rows behind the current Usage view. The server checks the caller is an administrator. */
export default function McpUsageExport({ window: range, q, exportAction }: Props) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (format: 'csv' | 'json') =>
    start(async () => {
      setMessage(null);
      try {
        const result = await exportAction({ window: range, ...(q ? { q } : {}), format });
        download(result);
        setMessage(
          result.truncated
            ? `Exported the newest ${result.rows.toLocaleString()} rows; more matched. Narrow the window or the search to get the rest.`
            : `Exported ${result.rows.toLocaleString()} ${result.rows === 1 ? 'row' : 'rows'}.`
        );
      } catch {
        setMessage('The export failed. Try again, or narrow the window.');
      }
    });

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={pending}
          onClick={() => run('csv')}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Export CSV
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={pending}
          onClick={() => run('json')}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Export JSON
        </Button>
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
