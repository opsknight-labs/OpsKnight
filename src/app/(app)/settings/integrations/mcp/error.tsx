'use client';

import { InlineNotice } from '@/components/ui/InlineNotice';
import { Button } from '@/components/ui/shadcn/button';

export default function McpSettingsError({ reset }: { reset: () => void }) {
  return (
    <InlineNotice tone="error" title="This MCP page could not load">
      <p>
        Nothing was changed by the failed request. Try again; if it keeps failing, reload the page
        or ask an administrator to check the server logs.
      </p>
      <Button type="button" size="sm" variant="outline" className="mt-2" onClick={reset}>
        Try again
      </Button>
    </InlineNotice>
  );
}
