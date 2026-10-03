import 'server-only';

import prisma from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/encryption';
import { logAudit } from '@/lib/audit';
import { createRunbookSecretSchema, updateRunbookSecretSchema } from './schemas';
import { collectSecretReferences, extractSecretName, isSecretReference } from './definition';
import { RunbookSecretNotFoundError } from './errors';

export async function createRunbookSecret(raw: unknown, actorId: string) {
  const input = createRunbookSecretSchema.parse(raw);
  const valueEncrypted = await encrypt(input.value);
  return prisma.$transaction(async tx => {
    const secret = await tx.runbookSecret.create({
      data: {
        name: input.name,
        description: input.description,
        valueEncrypted,
        createdById: actorId,
      },
    });
    await logAudit(
      {
        action: 'runbook.secret.created',
        entityType: 'RUNBOOK_SECRET',
        entityId: secret.id,
        actorId,
        details: { name: secret.name },
      },
      tx
    );
    return { id: secret.id, name: secret.name, description: secret.description };
  });
}

export async function rotateRunbookSecret(secretId: string, raw: unknown, actorId: string) {
  const input = updateRunbookSecretSchema.parse(raw);
  const valueEncrypted = input.value === undefined ? undefined : await encrypt(input.value);
  return prisma.$transaction(async tx => {
    const secret = await tx.runbookSecret.update({
      where: { id: secretId },
      data: { description: input.description, valueEncrypted },
    });
    await logAudit(
      {
        action: 'runbook.secret.rotated',
        entityType: 'RUNBOOK_SECRET',
        entityId: secret.id,
        actorId,
        details: { name: secret.name, valueRotated: valueEncrypted !== undefined },
      },
      tx
    );
    return { id: secret.id, name: secret.name, description: secret.description };
  });
}

export async function resolveSecretInputValues(values: Record<string, unknown>) {
  const names = [...collectSecretReferences(values)];
  if (names.length === 0) return values;
  const records = await prisma.runbookSecret.findMany({ where: { name: { in: names } } });
  const byName = new Map(records.map(record => [record.name, record.valueEncrypted]));
  const resolvedEntries = await Promise.all(
    Object.entries(values).map(async ([key, value]) => {
      if (!isSecretReference(value)) {
        return [key, value] as const;
      }
      const name = extractSecretName(value);
      const encrypted = byName.get(name);
      if (!encrypted) throw new RunbookSecretNotFoundError(name);
      return [key, await decrypt(encrypted)] as const;
    })
  );
  return Object.fromEntries(resolvedEntries);
}
