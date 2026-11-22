import { z } from 'zod/v3';
import type { TimeWindow } from './contract';

const DAY_MS = 86_400_000;
const MAX_WINDOW_DAYS = 400;

/** `from`/`to` query: ISO timestamps, default the last 30 days, at most 400 days wide. */
export const ImpactWindowQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .transform((query, ctx): TimeWindow => {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * DAY_MS);
    if (from >= to) ctx.addIssue({ code: 'custom', path: ['from'], message: 'Must be before to.' });
    if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS)
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'At most 400 days.' });
    return { from, to };
  });
