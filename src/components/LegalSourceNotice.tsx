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

/**
 * Persistent, low-profile AGPL/source affordance.
 *
 * Official builds can inject an immutable deployed-version URL with
 * NEXT_PUBLIC_SOURCE_CODE_URL. Modified network deployments should point that
 * value at the Corresponding Source for the version they are serving.
 */
export default function LegalSourceNotice() {
  const sourceUrl = safeSourceUrl(process.env.NEXT_PUBLIC_SOURCE_CODE_URL);

  return (
    <aside
      aria-label="OpsKnight license and source code"
      className="fixed bottom-20 right-3 z-[1100] flex items-center gap-1.5 rounded-md border border-border/70 bg-background/90 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/75 md:bottom-3"
    >
      <a
        href={AGPL_LICENSE_URL}
        target="_blank"
        rel="noopener noreferrer license"
        className="rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        AGPL-3.0-only
      </a>
      <span aria-hidden="true">·</span>
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        Source code
      </a>
    </aside>
  );
}
