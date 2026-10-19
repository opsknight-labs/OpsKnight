import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { builtinFields, snapshotSchema, type Field } from './contract';
import { getAutomationSettings } from './settings';

export type ServiceAutomationContextField = {
  key: string;
  label: string;
  type: Field['type'];
  caseSensitive: boolean;
  allowedValues?: string[];
};

export type ServiceAutomationContextFields = {
  mode: 'DISABLED' | 'SHADOW' | 'LIVE';
  versionNumber: number | null;
  fields: ServiceAutomationContextField[];
};

function toContextField(field: Field): ServiceAutomationContextField {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    caseSensitive: field.caseSensitive,
    ...(field.type === 'ENUM' && field.allowedValues?.length
      ? { allowedValues: [...field.allowedValues] }
      : {}),
  };
}

/**
 * Read-only view of the fields a runbook trigger can reference as `context.<key>`.
 * Mirrors the capture order used for incident response context (builtins first, then the
 * active version's declared fields, de-duplicated by key and capped at the capture limit).
 * The global automation switch is folded into `mode` because no LIVE context is captured
 * while it is off.
 */
export async function getServiceAutomationContextFields(
  serviceId: string,
  client: Prisma.TransactionClient = prisma
): Promise<ServiceAutomationContextFields> {
  const [settings, config] = await Promise.all([
    getAutomationSettings(client),
    client.serviceAutomationConfig.findUnique({
      where: { serviceId },
      select: {
        mode: true,
        activeVersion: { select: { versionNumber: true, snapshot: true } },
      },
    }),
  ]);
  const declared = config?.activeVersion
    ? (snapshotSchema.safeParse(config.activeVersion.snapshot).data?.fields ?? [])
    : [];
  const seen = new Set<string>();
  const fields: ServiceAutomationContextField[] = [];
  for (const field of [...builtinFields, ...declared]) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    fields.push(toContextField(field));
  }
  return {
    mode: settings.automationEnabled ? (config?.mode ?? 'DISABLED') : 'DISABLED',
    versionNumber: config?.activeVersion?.versionNumber ?? null,
    fields,
  };
}
