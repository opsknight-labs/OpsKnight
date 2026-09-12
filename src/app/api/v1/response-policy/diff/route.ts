import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { diffClassificationPolicies } from '@/lib/incidents/response-policy';

export async function GET(request: NextRequest) {
  const auth = await authorizeResponsePolicyApi(request, 'read');
  if (!auth.ok) return jsonError(auth.message, auth.status);
  const scopeKey = request.nextUrl.searchParams.get('scopeKey') ?? 'workspace';
  const resource = request.nextUrl.searchParams.get('resource') ?? 'classification';
  const from = Number(request.nextUrl.searchParams.get('from'));
  const to = Number(request.nextUrl.searchParams.get('to'));
  if (
    !/^(workspace|service:[A-Za-z0-9_-]+|integration:[A-Za-z0-9_-]+)$/.test(scopeKey) ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    !['classification', 'sla', 'support-hours'].includes(resource)
  )
    return jsonError('Invalid diff query', 400);
  if (resource !== 'classification' && scopeKey.startsWith('integration:'))
    return jsonError('Invalid scopeKey for policy resource', 400);
  const where = { scopeKey, version: { in: [from, to] }, sealedAt: { not: null } };
  const versions =
    resource === 'classification'
      ? await prisma.incidentClassificationPolicy.findMany({ where, include: { rules: true } })
      : resource === 'sla'
        ? await prisma.incidentSlaPolicy.findMany({ where, include: { rules: true } })
        : await prisma.responseSupportHoursPolicy.findMany({
            where,
            include: { windows: true, exceptions: true },
          });
  const before = versions.find(version => version.version === from);
  const after = versions.find(version => version.version === to);
  if (!before || !after) return jsonError('Policy version not found', 404);
  if (resource === 'classification')
    return jsonOk({ changes: diffClassificationPolicies(before as never, after as never) });
  const normalizeSla = (
    value: (typeof versions)[number] & { rules?: Array<Record<string, unknown>> }
  ) => ({
    scopeKey: value.scopeKey,
    inheritWorkspace: 'inheritWorkspace' in value ? value.inheritWorkspace : false,
    baseAckTargetMs: 'baseAckTargetMs' in value ? value.baseAckTargetMs : null,
    baseResolveTargetMs: 'baseResolveTargetMs' in value ? value.baseResolveTargetMs : null,
    rules: [...(value.rules ?? [])]
      .map(rule => ({
        priority: rule.priority,
        ackTargetMs: rule.ackTargetMs,
        resolveTargetMs: rule.resolveTargetMs,
        label: rule.label,
      }))
      .sort((left, right) => String(left.priority).localeCompare(String(right.priority))),
  });
  const normalizeSupportHours = (
    value: (typeof versions)[number] & {
      windows?: Array<Record<string, unknown>>;
      exceptions?: Array<Record<string, unknown>>;
    }
  ) => ({
    scopeKey: value.scopeKey,
    timezone: 'timezone' in value ? value.timezone : null,
    mode: 'mode' in value ? value.mode : null,
    inheritWorkspace: 'inheritWorkspace' in value ? value.inheritWorkspace : false,
    windows: [...(value.windows ?? [])]
      .map(window => ({
        dayOfWeek: window.dayOfWeek,
        startMinute: window.startMinute,
        endMinute: window.endMinute,
      }))
      .sort(
        (left, right) =>
          Number(left.dayOfWeek) - Number(right.dayOfWeek) ||
          Number(left.startMinute) - Number(right.startMinute)
      ),
    exceptions: [...(value.exceptions ?? [])]
      .map(exception => ({
        localDate:
          exception.localDate instanceof Date
            ? exception.localDate.toISOString().slice(0, 10)
            : exception.localDate,
        available: exception.available,
        startMinute: exception.startMinute,
        endMinute: exception.endMinute,
        label: exception.label,
      }))
      .sort((left, right) => String(left.localDate).localeCompare(String(right.localDate))),
  });
  return jsonOk({
    changes: [
      {
        field: resource,
        from:
          resource === 'sla'
            ? normalizeSla(before as never)
            : normalizeSupportHours(before as never),
        to:
          resource === 'sla' ? normalizeSla(after as never) : normalizeSupportHours(after as never),
      },
    ],
  });
}
