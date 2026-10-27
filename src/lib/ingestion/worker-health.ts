type IngestionWorkerHealth = {
  running: boolean;
  faulted: boolean;
  retentionFaulted: boolean;
  lastSuccessAt: number | null;
};

declare global {
  var opsknightIngestionWorkerHealth: IngestionWorkerHealth | undefined;
}

// Instrumentation and route handlers may be emitted into different bundles.
// Share this process-local evidence without opening another database client.
export function updateIngestionWorkerHealth(update: Partial<IngestionWorkerHealth>) {
  globalThis.opsknightIngestionWorkerHealth = {
    ...getIngestionWorkerHealth(),
    ...update,
  };
}

export function getIngestionWorkerHealth(): IngestionWorkerHealth {
  return {
    ...(globalThis.opsknightIngestionWorkerHealth ?? {
      running: false,
      faulted: false,
      retentionFaulted: false,
      lastSuccessAt: null,
    }),
  };
}
