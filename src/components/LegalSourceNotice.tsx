const UPSTREAM_REPOSITORY = 'https://github.com/opsknight-labs/OpsKnight';
const AGPL_LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

function safeSourceUrl(value: string | undefined): string {
  if (!value) return UPSTREAM_REPOSITORY;

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString();
  } catch {
    // Fall back to the official source repository for invalid configuration.
  }

  return UPSTREAM_REPOSITORY;
}

/**
 * Persistent legal/source affordance for every interactive OpsKnight surface.
 *
 * Official container builds inject an immutable commit URL through
 * NEXT_PUBLIC_SOURCE_CODE_URL. Downstream operators that ship a modified build
 * must point this value at the Corresponding Source for the version they run.
 */
export default function LegalSourceNotice() {
  const sourceUrl = safeSourceUrl(process.env.NEXT_PUBLIC_SOURCE_CODE_URL);

  return (
    <aside
      aria-label="OpsKnight software license and source code"
      className="fixed bottom-2 right-2 z-[1200] flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/90 px-2.5 py-1 text-[10px] font-medium text-slate-500 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-950/90 dark:text-slate-400"
      title="OpsKnight Community is provided without warranty under AGPL-3.0-only. View the license and Corresponding Source."
    >
      <a
        href={AGPL_LICENSE_URL}
        target="_blank"
        rel="noopener noreferrer license"
        className="hover:text-slate-900 hover:underline dark:hover:text-slate-100"
      >
        AGPL-3.0-only
      </a>
      <span aria-hidden="true">·</span>
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-slate-900 hover:underline dark:hover:text-slate-100"
      >
        Source
      </a>
    </aside>
  );
}
