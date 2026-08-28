import { AppError, type AppErrorCode, type ErrorField } from '@/lib/errors';

export type PrismaErrorInfo = {
  code: string;
  fields: string[];
};

type AppErrorFactoryOptions = {
  code: AppErrorCode;
  userMessage?: string;
  action?: string;
  retryable?: boolean;
  fields?: ErrorField[];
  details?: Record<string, unknown>;
};

export type PrismaAppErrorMapping = {
  unique?: AppErrorFactoryOptions | ((fields: string[]) => AppErrorFactoryOptions);
  notFound?: AppErrorFactoryOptions | (() => AppErrorFactoryOptions);
  writeConflict?: AppErrorFactoryOptions | (() => AppErrorFactoryOptions);
};

function readStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Extract only Prisma's structured machine metadata. This helper intentionally
 * does not inspect exception messages, so database wording can never control
 * application semantics.
 */
export function getPrismaErrorInfo(error: unknown): PrismaErrorInfo | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const candidate = error as { code?: unknown; meta?: unknown };
  if (typeof candidate.code !== 'string' || !/^P\d{4}$/.test(candidate.code)) {
    return undefined;
  }

  const meta =
    candidate.meta && typeof candidate.meta === 'object'
      ? (candidate.meta as Record<string, unknown>)
      : undefined;
  const fields = readStringArray(meta?.target);

  return { code: candidate.code, fields };
}

export function isPrismaErrorCode(error: unknown, code: string): boolean {
  return getPrismaErrorInfo(error)?.code === code;
}

export function getPrismaUniqueFields(error: unknown): string[] {
  const info = getPrismaErrorInfo(error);
  return info?.code === 'P2002' ? info.fields : [];
}

function resolveUniqueMapping(
  mapping: NonNullable<PrismaAppErrorMapping['unique']>,
  fields: string[]
): AppErrorFactoryOptions {
  return typeof mapping === 'function' ? mapping(fields) : mapping;
}

function resolveNoArgMapping(
  mapping: NonNullable<PrismaAppErrorMapping['notFound'] | PrismaAppErrorMapping['writeConflict']>
): AppErrorFactoryOptions {
  return typeof mapping === 'function' ? mapping() : mapping;
}

function toAppError(
  options: AppErrorFactoryOptions,
  error: unknown,
  prisma: PrismaErrorInfo
): AppError {
  return new AppError({
    ...options,
    details: {
      prismaCode: prisma.code,
      prismaFields: prisma.fields,
      ...options.details,
    },
    cause: error,
  });
}

/**
 * Map the Prisma errors that have stable application semantics. Callers supply
 * domain/public wording; this adapter owns interpretation of Prisma codes.
 */
export function prismaToAppError(
  error: unknown,
  mapping: PrismaAppErrorMapping
): AppError | undefined {
  const prisma = getPrismaErrorInfo(error);
  if (!prisma) return undefined;

  if (prisma.code === 'P2002' && mapping.unique) {
    return toAppError(resolveUniqueMapping(mapping.unique, prisma.fields), error, prisma);
  }

  if (prisma.code === 'P2025' && mapping.notFound) {
    return toAppError(resolveNoArgMapping(mapping.notFound), error, prisma);
  }

  if (prisma.code === 'P2034' && mapping.writeConflict) {
    return toAppError(resolveNoArgMapping(mapping.writeConflict), error, prisma);
  }

  return undefined;
}
