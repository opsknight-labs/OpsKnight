import { logger } from '@/lib/logger';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { readChangeReference } from '@/lib/intelligence/squire/references';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ChangeReferencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let change;
  try {
    change = await readChangeReference(await getCurrentAuthorizationActor(), id);
  } catch (error) {
    logger.error('[Intelligence] Change source unavailable', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    throw error;
  }
  if (!change) notFound();
  return (
    <article className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <h1 className="break-words text-2xl font-semibold">{change.summary}</h1>
      <p className="text-sm text-muted-foreground">
        Recorded change · {change.kind.toLowerCase()} · {change.source} ·{' '}
        {change.occurredAt.toISOString()}
      </p>
      <p className="text-sm">
        Timing is evidence to investigate; it does not establish that a change caused an incident.
      </p>
      {change.service && (
        <Link href={`/services/${change.service.id}`} className="text-sm underline">
          {change.service.name}
        </Link>
      )}
    </article>
  );
}
