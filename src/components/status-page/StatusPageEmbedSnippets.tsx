'use client';

import { useState } from 'react';

/**
 * Copy-paste embed options for a public status page (admin-side helper).
 * `origin` is the public base URL (custom domain when set); `slug` the page slug.
 */
export default function StatusPageEmbedSnippets({
  origin,
  slug,
  pageName,
}: {
  origin: string;
  slug: string;
  pageName: string;
}) {
  const base = origin.replace(/\/$/, '');
  const s = encodeURIComponent(slug);
  const pageUrl = `${base}/status/${s}`;
  const snippets = [
    {
      id: 'iframe',
      label: 'Embed (iframe)',
      value: `<iframe src="${pageUrl}/embed" title="${pageName.replace(/"/g, '&quot;')} status" width="100%" height="320" style="border:0" loading="lazy"></iframe>`,
    },
    {
      id: 'badge',
      label: 'Badge (Markdown)',
      value: `[![${pageName} status](${base}/api/status/${s}/badge)](${pageUrl})`,
    },
    { id: 'json', label: 'JSON URL', value: `${base}/api/status/${s}` },
  ];
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setTimeout(() => setCopied(current => (current === id ? null : current)), 1500);
    } catch {
      // Clipboard can be blocked; the text stays selectable in the field.
    }
  };
  return (
    <div className="space-y-3">
      {snippets.map(snippet => (
        <div key={snippet.id} className="space-y-1">
          <label htmlFor={`embed-${snippet.id}`} className="text-sm font-medium">
            {snippet.label}
          </label>
          <div className="flex gap-2">
            <input
              id={`embed-${snippet.id}`}
              readOnly
              value={snippet.value}
              onFocus={event => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded border px-2 py-1 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => copy(snippet.id, snippet.value)}
              className="rounded border px-3 py-1 text-sm"
            >
              {copied === snippet.id ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
