import { z } from 'zod';

export const diagnosticQuerySchema = z
  .object({
    view: z.enum(['sessions', 'deliveries', 'audit', 'replicas']).default('sessions'),
    q: z.string().trim().max(100).default(''),
    method: z.enum(['all', 'credentials', 'oidc']).default('all'),
    state: z
      .enum([
        'all',
        'ACTIVE',
        'EXPIRED',
        'REVOKED',
        'FAILED',
        'PENDING',
        'ACCEPTED',
        'DELIVERED',
        'CANCELLED',
        'consistent',
        'conflicting',
      ])
      .default('all'),
    range: z.enum(['24h', '7d', '30d', 'all', 'custom']).default('7d'),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    sort: z.enum(['activity', 'created', 'expires']).default('activity'),
    pageSize: z.coerce
      .number()
      .refine(value => [25, 50, 100].includes(value))
      .default(25),
    after: z.string().max(4096).optional(),
    eventType: z.string().trim().max(128).default(''),
    outcome: z.string().trim().max(32).default(''),
    actor: z.string().trim().max(128).default(''),
    observation: z.enum(['active', 'historical', 'all']).default('active'),
  })
  .strict()
  .superRefine((value, context) => {
    const states =
      value.view === 'sessions'
        ? ['all', 'ACTIVE', 'EXPIRED', 'REVOKED']
        : value.view === 'deliveries'
          ? ['all', 'FAILED', 'PENDING', 'ACCEPTED', 'DELIVERED', 'CANCELLED']
          : value.view === 'replicas'
            ? ['all', 'consistent', 'conflicting']
            : ['all'];
    if (!states.includes(value.state))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['state'],
        message: 'Choose a status supported by this view.',
      });
    if (value.view !== 'sessions' && (value.method !== 'all' || value.sort !== 'activity'))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['method'],
        message: 'Method and session sorting apply only to sessions.',
      });
    if (value.view !== 'audit' && (value.eventType || value.outcome || value.actor))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actor'],
        message: 'Audit event filters apply only to the audit view.',
      });
    if (
      value.range === 'custom' &&
      (!value.from || !value.to || new Date(value.from) >= new Date(value.to))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: 'Choose a valid start and end time.',
      });
    }
  });
export type DiagnosticQuery = z.infer<typeof diagnosticQuerySchema>;
export type DiagnosticItem = {
  id: string;
  title: string;
  subtitle: string;
  state: string;
  createdAt: string;
  activityAt: string;
  source: string;
  details: Array<{ label: string; value: string }>;
  timeline?: Array<{ label: string; at: string }>;
  canRevoke?: boolean;
  canRetry?: boolean;
  generation?: number;
  actionExplanation?: string;
};
export type DiagnosticPage = {
  items: DiagnosticItem[];
  nextCursor: string | null;
  hasMore: boolean;
  pageSize: number;
  snapshotAt: string;
};
