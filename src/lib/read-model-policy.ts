export const READ_MODEL_POLICY = {
  ALLOW_STALE: 'ALLOW_STALE',
  REQUIRE_FRESH: 'REQUIRE_FRESH',
} as const;

export type ReadModelPolicy = (typeof READ_MODEL_POLICY)[keyof typeof READ_MODEL_POLICY];
