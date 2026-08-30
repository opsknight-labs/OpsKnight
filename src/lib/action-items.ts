export type ActionItemStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
export type ActionItemPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export type ActionItemExternalIssue = {
  linkId: string;
  provider: string;
  key: string;
  url: string;
  status?: string;
  assignee?: string;
  syncState?: string;
};

export type ActionItem = {
  id: string;
  title: string;
  description: string;
  owner?: string;
  dueDate?: string;
  status: ActionItemStatus;
  priority: ActionItemPriority;
  externalIssue?: ActionItemExternalIssue;
  completedAt?: Date | string | null;
};

type ActionItemRecordLike = {
  id: string;
  title: string;
  description: string | null;
  ownerId: string | null;
  dueDate: Date | string | null;
  status: ActionItemStatus;
  priority: ActionItemPriority;
  completedAt?: Date | string | null;
  externalIssueLinks?: Array<{
    id: string;
    provider: string;
    externalKey: string;
    externalUrl: string;
    externalStatus: string | null;
    externalAssignee: string | null;
    syncState?: string | null;
  }>;
};

const ACTION_ITEM_STATUSES = new Set<ActionItemStatus>([
  'OPEN',
  'IN_PROGRESS',
  'COMPLETED',
  'BLOCKED',
]);

const ACTION_ITEM_PRIORITIES = new Set<ActionItemPriority>(['HIGH', 'MEDIUM', 'LOW']);

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function toActionItemStatus(value: unknown): ActionItemStatus {
  return typeof value === 'string' && ACTION_ITEM_STATUSES.has(value as ActionItemStatus)
    ? (value as ActionItemStatus)
    : 'OPEN';
}

function toActionItemPriority(value: unknown): ActionItemPriority {
  return typeof value === 'string' && ACTION_ITEM_PRIORITIES.has(value as ActionItemPriority)
    ? (value as ActionItemPriority)
    : 'MEDIUM';
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function sanitizeIdentifierPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
}

export function getStoredActionItemId(params: {
  postmortemId: string;
  legacyId?: string;
  index: number;
}): string {
  const sanitizedPmId = sanitizeIdentifierPart(params.postmortemId);
  const expectedPrefix = `ai_${sanitizedPmId}_`;
  if (params.legacyId?.startsWith(expectedPrefix)) {
    return params.legacyId;
  }

  const source = params.legacyId?.trim() || `index_${params.index}`;
  return `${expectedPrefix}${sanitizeIdentifierPart(source)}`;
}

export function formatActionItemDueDate(
  value: Date | string | null | undefined
): string | undefined {
  if (!value) return undefined;

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;

  return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}`;
}

export function parseActionItemDueDate(value: string | null | undefined): Date | undefined {
  const raw = toStringOrUndefined(value);
  if (!raw) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T00:00:00.000Z`);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function normalizeLegacyActionItems(
  value: unknown,
  options: { legacyIdPrefix?: string } = {}
): ActionItem[] {
  if (!Array.isArray(value)) return [];

  const legacyIdPrefix = options.legacyIdPrefix ?? 'legacy-action-item';

  return value.map((item, index) => {
    const entry = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};

    return {
      id: toStringOrUndefined(entry.id) ?? `${legacyIdPrefix}-${index}`,
      title: toStringOrUndefined(entry.title) ?? '',
      description: toStringOrUndefined(entry.description) ?? '',
      owner: toStringOrUndefined(entry.owner),
      dueDate: formatActionItemDueDate(
        entry.dueDate instanceof Date || typeof entry.dueDate === 'string'
          ? entry.dueDate
          : undefined
      ),
      status: toActionItemStatus(entry.status),
      priority: toActionItemPriority(entry.priority),
      completedAt:
        entry.completedAt instanceof Date || typeof entry.completedAt === 'string'
          ? entry.completedAt
          : null,
    };
  });
}

export function serializeActionItemRecord(record: ActionItemRecordLike): ActionItem {
  const [externalIssue] = record.externalIssueLinks ?? [];

  return {
    id: record.id,
    title: record.title,
    description: record.description ?? '',
    owner: record.ownerId ?? undefined,
    dueDate: formatActionItemDueDate(record.dueDate),
    status: record.status,
    priority: record.priority,
    completedAt: record.completedAt,
    externalIssue: externalIssue
      ? {
          linkId: externalIssue.id,
          provider: externalIssue.provider,
          key: externalIssue.externalKey,
          url: externalIssue.externalUrl,
          status: externalIssue.externalStatus ?? undefined,
          assignee: externalIssue.externalAssignee ?? undefined,
          syncState: externalIssue.syncState ?? undefined,
        }
      : undefined,
  };
}

export function resolveStoredActionItems(params: {
  records?: ActionItemRecordLike[] | null;
  legacy?: unknown;
  legacyIdPrefix?: string;
}): ActionItem[] {
  const records = params.records ?? [];

  // Rolling-deploy contract: once a postmortem has normalized rows, they
  // become the source of truth for reads. Backfill must therefore migrate
  // one postmortem atomically to avoid mixed-source duplication.
  if (records.length > 0) {
    return records.map(serializeActionItemRecord);
  }

  return normalizeLegacyActionItems(params.legacy, {
    legacyIdPrefix: params.legacyIdPrefix,
  });
}
