import { NextResponse } from 'next/server';
import type { ObjectiveWindow } from './types';

export const LEGACY_SLA_DEPRECATION_HEADERS = {
  Deprecation: 'true',
  Sunset: 'Thu, 31 Dec 2026 23:59:59 GMT',
  Link: '</api/v1/service-objectives>; rel="successor-version"',
} as const;

export function legacySlaGone() {
  return NextResponse.json(
    {
      error: 'Legacy SLA definition writes are retired. Use /api/v1/service-objectives.',
      code: 'LEGACY_SLA_WRITE_RETIRED',
    },
    { status: 410, headers: LEGACY_SLA_DEPRECATION_HEADERS }
  );
}

export function legacyWindow(windowType: ObjectiveWindow, windowValue: number | null): string {
  switch (windowType) {
    case 'SEVEN_DAYS':
      return '7d';
    case 'THIRTY_DAYS':
      return '30d';
    case 'NINETY_DAYS':
      return '90d';
    case 'QUARTERLY':
      return 'quarterly';
    case 'YEARLY':
      return 'yearly';
    case 'ROLLING_DAYS':
      return `${windowValue ?? 30}d`;
  }
}
