import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { DigestSettingsForm, SendTestDigestButton } from '@/components/settings/InsightsForms';
import { Badge } from '@/components/ui/shadcn/badge';
import { logger } from '@/lib/logger';
import { getDigestSettings, getLatestDigestRun } from '@/lib/intelligence/digest/service';

/**
 * The weekly digest switch, on the Engine page beside the operations-insight switches it summarises.
 * Renders nothing when it cannot load; the rest of the page is unaffected.
 */
export default async function DigestSection({ canManage }: { canManage: boolean }) {
  let loaded: [
    Awaited<ReturnType<typeof getDigestSettings>>,
    Awaited<ReturnType<typeof getLatestDigestRun>>,
  ];
  try {
    loaded = await Promise.all([getDigestSettings(), getLatestDigestRun()]);
  } catch (error) {
    logger.warn('[Intelligence] Weekly digest settings could not load', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  const [digest, lastRun] = loaded;
  return (
    <SettingsSection
      id="digest"
      title="Weekly digest"
      description="A short email with the week's numbers, recurring problems, unusual volume and open insights. Off by default; it never changes anything."
      action={
        <Badge variant={digest.enabled ? 'default' : 'secondary'}>
          {digest.enabled ? 'On' : 'Off'}
        </Badge>
      }
    >
      <DigestSettingsForm settings={digest} canManage={canManage} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3">
        <p className="text-xs text-muted-foreground">
          {lastRun
            ? `Last digest ${lastRun.weekKey}: ${lastRun.status === 'COMPLETED' ? 'sent' : 'sending'} to ${lastRun.sent} ${lastRun.sent === 1 ? 'person' : 'people'}${lastRun.failed > 0 ? `, ${lastRun.failed} not delivered` : ''}.`
            : 'No digest has been sent yet.'}
        </p>
        {canManage && <SendTestDigestButton />}
      </div>
    </SettingsSection>
  );
}
