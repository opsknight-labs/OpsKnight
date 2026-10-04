import { z } from 'zod';

const measurement = z.number().finite();
export const verificationResultSchema = z
  .object({
    verified: z.boolean(),
    checkKeys: z.array(z.string()),
    capturedAt: z.string().datetime(),
    reason: z.string(),
    differences: z.array(
      z.object({ field: z.string(), before: z.string(), after: z.string() }).strict()
    ),
  })
  .strict();
export const runbookEvidenceSchema = z
  .object({
    capturedAt: z.string().datetime(),
    cpu: z
      .object({ load1: measurement, cores: z.number().int().min(1).max(65536) })
      .strict()
      .optional(),
    memory: z
      .object({ usedBytes: measurement.nonnegative(), totalBytes: measurement.nonnegative() })
      .strict()
      .optional(),
    load: z.array(measurement).max(3).optional(),
    disk: z.string().max(4096).optional(),
    processes: z.string().max(4096).optional(),
    serviceState: z.string().max(100).optional(),
    containerState: z.string().max(4096).optional(),
    kubernetesState: z
      .object({
        desired: z.number().int().nonnegative(),
        ready: z.number().int().nonnegative(),
        observedGeneration: z.number().int().nonnegative(),
        generation: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    ports: z
      .array(
        z.object({ port: z.number().int().min(1).max(65535), listening: z.boolean() }).strict()
      )
      .max(32)
      .optional(),
    healthChecks: z
      .array(
        z
          .object({
            url: z.string().max(2048),
            status: z.number().int().min(100).max(599),
            healthy: z.boolean(),
          })
          .strict()
      )
      .max(16)
      .optional(),
    logSummary: z.string().max(4096).optional(),
    captureError: z.string().max(200).optional(),
  })
  .strict();

export function compareEvidence(pre: unknown, post: unknown) {
  const before = runbookEvidenceSchema.safeParse(pre);
  const after = runbookEvidenceSchema.safeParse(post);
  if (!before.success || !after.success)
    return {
      healthy: false,
      differences: [] as { field: string; before: string; after: string }[],
    };
  const differences = [
    ...new Set([...Object.keys(before.data), ...Object.keys(after.data)]),
  ].flatMap(field => {
    const value = Object.entries(before.data).find(([key]) => key === field)?.[1];
    const next = Object.entries(after.data).find(([key]) => key === field)?.[1];
    if (field === 'capturedAt' || JSON.stringify(value) === JSON.stringify(next)) return [];
    return [
      {
        field,
        before:
          value === undefined
            ? 'Not captured'
            : typeof value === 'string'
              ? value
              : JSON.stringify(value),
        after:
          next === undefined
            ? 'Not captured'
            : typeof next === 'string'
              ? next
              : JSON.stringify(next),
      },
    ];
  });
  let containerHealthy = false;
  if (after.data.containerState) {
    try {
      const health = z
        .object({ Status: z.string().optional() })
        .passthrough()
        .nullable()
        .optional();
      const state = z
        .object({
          Running: z.boolean(),
          Paused: z.boolean().optional(),
          Restarting: z.boolean().optional(),
          Dead: z.boolean().optional(),
          Health: health,
          Healthcheck: health,
        })
        .passthrough()
        .safeParse(JSON.parse(after.data.containerState));
      if (state.success)
        containerHealthy =
          state.data.Running &&
          !state.data.Paused &&
          !state.data.Restarting &&
          !state.data.Dead &&
          [state.data.Health?.Status, state.data.Healthcheck?.Status].every(
            status => !status || status === 'healthy'
          );
    } catch {
      /* Invalid state is never evidence of recovery. */
    }
  }
  const goals: boolean[] = [];
  if (after.data.serviceState !== undefined) goals.push(after.data.serviceState === 'active');
  if (after.data.containerState !== undefined) goals.push(containerHealthy);
  if (after.data.kubernetesState) {
    const state = after.data.kubernetesState;
    goals.push(
      state.desired > 0 &&
        state.ready >= state.desired &&
        state.observedGeneration >= state.generation
    );
  }
  if (after.data.ports?.length) goals.push(after.data.ports.every(port => port.listening));
  if (after.data.healthChecks?.length)
    goals.push(after.data.healthChecks.every(check => check.healthy));
  return {
    healthy: goals.length > 0 && goals.every(Boolean) && !after.data.captureError,
    differences,
  };
}
