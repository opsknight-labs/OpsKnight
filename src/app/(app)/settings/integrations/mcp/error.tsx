'use client';
export default function McpSettingsError({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="rounded border p-6 space-y-3">
      <p>
        Something went wrong while loading or saving this MCP page. Nothing was changed by the
        failed request. Try again; if it keeps failing, reload the page or ask an administrator to
        check the server logs.
      </p>
      <button onClick={reset} className="rounded border px-4 py-2">
        Try again
      </button>
    </div>
  );
}
