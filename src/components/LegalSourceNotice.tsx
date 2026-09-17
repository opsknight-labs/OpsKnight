import React from 'react';
import { cn } from '@/lib/utils';

const UPSTREAM_REPOSITORY = 'https://github.com/opsknight-labs/OpsKnight';
const AGPL_LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

function safeSourceUrl(value: string | undefined): string {
  if (!value) return UPSTREAM_REPOSITORY;

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString();
  } catch {
    // Invalid operator configuration must never remove the source affordance.
  }

  return UPSTREAM_REPOSITORY;
}

type LegalSourceNoticeProps = {
  className?: string;
};

/**
 * Persistent AGPL/source affordance.
 *
 * Official builds can inject an immutable deployed-version URL with
 * NEXT_PUBLIC_SOURCE_CODE_URL. Modified network deployments should point that
 * value at the Corresponding Source for the version they are serving.
 */
export default function LegalSourceNotice({ className }: LegalSourceNoticeProps = {}) {
  const sourceUrl = safeSourceUrl(process.env.NEXT_PUBLIC_SOURCE_CODE_URL);

  return (
    <aside
      aria-label="OpsKnight license and source code"
      className={cn(
        'flex items-center gap-1.5 text-[10px] text-slate-500 font-normal truncate',
        className
      )}
    >
      <a
        href={AGPL_LICENSE_URL}
        target="_blank"
        rel="noopener noreferrer license"
        className="transition-colors hover:text-slate-300"
      >
        AGPL-3.0-only
      </a>
      <span aria-hidden="true" className="text-slate-600">
        ·
      </span>
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="transition-colors hover:text-slate-300"
      >
        Source code
      </a>
    </aside>
  );
}
