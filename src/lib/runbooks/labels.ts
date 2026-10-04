import { z } from 'zod';

/** Scheduling labels are written only through administrator-authorized actions. */
export const schedulingLabelsSchema = z
  .record(z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/), z.string().max(200))
  .refine(labels => Object.keys(labels).length <= 32, 'Maximum 32 scheduling labels.');
