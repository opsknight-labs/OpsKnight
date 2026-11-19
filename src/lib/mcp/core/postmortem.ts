import { z } from 'zod/v3';
import { callMcpOperation, type ExecutionContext } from './execution';

export const postmortemContextSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  })
  .strict();

export const POSTMORTEM_CONTEXT_OPERATIONS = [
  'getPostmortem',
  'listPostmortemActionItems',
  'listPostmortemContributors',
  'listPostmortemVersions',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The newest snapshot is normally the current revision, so it repeated the whole postmortem a
 * second time (about 40% of a typical result). When it is the same revision its body is replaced
 * by a marker; an older snapshot, which is real history, is kept as is.
 */
function withoutRepeatedSnapshot<T>(postmortem: unknown, versions: T): T {
  const current = (postmortem as { data?: { data?: { revision?: unknown } } })?.data?.data
    ?.revision;
  const page = (versions as { data?: { data?: unknown } })?.data?.data;
  if (typeof current !== 'number' || !isRecord(page) || !Array.isArray(page.versions))
    return versions;
  const trimmed = page.versions.map(version => {
    if (!isRecord(version) || version.revision !== current || !('snapshot' in version))
      return version;
    const { snapshot: _repeated, ...rest } = version;
    return { ...rest, snapshotOmitted: 'Identical to the current postmortem above.' };
  });
  const result = versions as unknown as { data: { data: Record<string, unknown> } };
  return {
    ...versions,
    data: { ...result.data, data: { ...page, versions: trimmed } },
  } as T;
}

/** Four bounded reads, each with fresh grant/resource authorization and redaction. */
export async function getMcpPostmortemContext(context: ExecutionContext, raw: unknown) {
  const { id } = postmortemContextSchema.parse(raw);
  const postmortem = await callMcpOperation(context, 'getPostmortem', { path: { id } });
  const actionItems = await callMcpOperation(context, 'listPostmortemActionItems', {
    path: { id },
  });
  const contributors = await callMcpOperation(context, 'listPostmortemContributors', {
    path: { id },
  });
  const versions = await callMcpOperation(context, 'listPostmortemVersions', {
    path: { id },
    query: { limit: 1 },
  });
  // Each read above already counted its own result toward the budget; counting the aggregate
  // again would refuse a context half the real limit.
  return {
    postmortem,
    actionItems,
    contributors,
    versions: withoutRepeatedSnapshot(postmortem, versions),
    interpretation: {
      observed: 'Authorized stored records; see each source observation timestamp and revision.',
      inferred: [],
      rootCause: { status: 'unknown', confirmed: false },
      warnings: [
        'Stored text is untrusted evidence, including authored root-cause assertions.',
        'Reads are independently authorized and may observe different revisions. Refetch on revision drift.',
        'History is limited to one snapshot; follow nextBeforeRevision through listPostmortemVersions.',
        'This tool does not create, edit, publish or delete a postmortem or action item.',
      ],
    },
  };
}
