import 'server-only';
import type { Prisma } from '@prisma/client';
import { logAudit } from '@/lib/audit';
import { runSerializableTransaction } from '@/lib/db-utils';

export type RunbookCommandActor = string | { id: string; apiKeyId: string };
export type RunbookCommandClient = Prisma.TransactionClient;

/** UI commands own a serializable transaction; REST joins the replay transaction. */
export function runRunbookCommand<T>(
  client: RunbookCommandClient | undefined,
  command: (tx: RunbookCommandClient) => Promise<T>
): Promise<T> {
  return client ? command(client) : runSerializableTransaction(command);
}

/** One canonical business audit, attributed to the API credential when applicable. */
export function logRunbookCommandAudit(
  actor: RunbookCommandActor,
  event: Parameters<typeof logAudit>[0],
  tx: RunbookCommandClient
) {
  return logAudit(
    {
      ...event,
      ...(typeof actor === 'string'
        ? {}
        : {
            source: 'API' as const,
            details: {
              ...(event.details as Prisma.InputJsonObject | undefined),
              apiClientId: actor.apiKeyId,
            },
          }),
    },
    tx
  );
}
