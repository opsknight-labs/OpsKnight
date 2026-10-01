/**
 * Robust query parameter parsing and pagination bounds calculator.
 * Prevents NaN, negative offsets, and invalid enum values from reaching Prisma.
 */

export function parsePageParam(param: unknown, defaultPage: number = 1): number {
  if (param === null || param === undefined) return defaultPage;
  const raw = typeof param === 'string' ? param.trim() : param;
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 1) {
    return defaultPage;
  }
  return Math.floor(parsed);
}

export function parsePageSizeParam(
  param: unknown,
  defaultSize: number = 20,
  maxSize: number = 100
): number {
  if (param === null || param === undefined) return defaultSize;
  const raw = typeof param === 'string' ? param.trim() : param;
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 1) {
    return defaultSize;
  }
  return Math.min(Math.floor(parsed), maxSize);
}

export interface PaginationBounds {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  skip: number;
  take: number;
  startItem: number;
  endItem: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export function calculatePaginationBounds(options: {
  totalItems: number;
  page: number;
  pageSize: number;
}): PaginationBounds {
  const pageSize = Math.max(1, options.pageSize);
  const totalItems = Math.max(0, Number.isFinite(options.totalItems) ? Math.floor(options.totalItems) : 0);
  const totalPages = totalItems === 0 ? 1 : Math.ceil(totalItems / pageSize);
  const clampedPage = Math.min(Math.max(1, options.page), totalPages);
  const skip = (clampedPage - 1) * pageSize;
  const startItem = totalItems === 0 ? 0 : skip + 1;
  const endItem = totalItems === 0 ? 0 : Math.min(skip + pageSize, totalItems);

  return {
    page: clampedPage,
    pageSize,
    totalItems,
    totalPages,
    skip,
    take: pageSize,
    startItem,
    endItem,
    hasPrev: clampedPage > 1,
    hasNext: clampedPage < totalPages,
  };
}

export function formatPaginationSummary(
  startItem: number,
  endItem: number,
  totalItems: number,
  itemName: string = 'items'
): string {
  if (totalItems === 0) {
    return `Showing 0 of 0 ${itemName}`;
  }
  return `Showing ${startItem}-${endItem} of ${totalItems} ${itemName}`;
}

export function parseEnumValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fallback?: T
): T | undefined {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim() as T;
  return (allowedValues as readonly string[]).includes(trimmed) ? trimmed : fallback;
}
