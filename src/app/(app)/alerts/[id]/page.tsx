import { logger } from '@/lib/logger';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { readAlertReference } from '@/lib/intelligence/squire/references';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AlertReferencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let alert;
  try {
    alert = await readAlertReference(await getCurrentAuthorizationActor(), id);
  } catch (error) {
    logger.error('[Intelligence] Alert source unavailable', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    throw error;
  }
  if (!alert) notFound();
  return (
    <article className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <h1 className="break-words text-2xl font-semibold">{alert.summary}</h1>
      <p className="text-sm text-muted-foreground">
        Recorded alert · {alert.status.toLowerCase()} · {alert.createdAt.toISOString()}
      </p>
      {alert.incidentId && (
        <Link href={`/incidents/${alert.incidentId}`} className="text-sm underline">
          Open incident
        </Link>
      )}
    </article>
  );
}
