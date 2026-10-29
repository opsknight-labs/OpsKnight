'use client';
export default function McpSettingsError({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="rounded border p-6 space-y-3">
      <p>
        MCP settings could not be loaded or saved. Check your permissions, consent expiry and
        database availability.
      </p>
      <button onClick={reset} className="rounded border px-4 py-2">
        Try again
      </button>
    </div>
  );
}
