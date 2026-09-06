'use client';

import { useReportWebVitals } from 'next/web-vitals';
import { logger } from '@/lib/logger';

// Type definition for Web Vitals Metric
type _Metric = {
  name: string;
  value: number;
  id: string;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  navigationType: string;
};

/**
 * Web Vitals Reporter Component
 * 
 * Uses Next.js 16's useReportWebVitals hook to collect and report 
 * Core Web Vitals and other performance metrics.
 * 
 * Metrics tracked:
 * - CLS (Cumulative Layout Shift): Visual stability
 * - FID (First Input Delay): Interactivity
 * - FCP (First Contentful Paint): Perceived load speed
 * - LCP (Largest Contentful Paint): Loading performance
 * - TTFB (Time to First Byte): Server response time
 * - INP (Interaction to Next Paint): Responsiveness (replaces FID)
 */
export default function WebVitalsReporter() {
  useReportWebVitals((metric: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    // Validate that we received a proper metric object
    if (!metric || typeof metric !== 'object' || !metric.name || typeof metric.value !== 'number') {
      if (process.env.NODE_ENV === 'development') {
        logger.warn('Invalid Web Vital metric received', { metric });
      }
      return;
    }

    // Log metrics in development for debugging
    if (process.env.NODE_ENV === 'development') {
      logger.info(`[Web Vitals] ${metric.name}`, {
        value: metric.name === 'CLS' ? metric.value.toFixed(4) : `${metric.value.toFixed(2)}ms`,
        rating: metric.rating || 'unknown',
        id: metric.id || 'unknown',
      });
    }

    // Only report in production or when explicitly enabled
    if (process.env.NODE_ENV !== 'production' && !process.env.NEXT_PUBLIC_ENABLE_WEB_VITALS) {
      return;
    }

    // Send to our API endpoint (async but don't await)
    fetch('/api/web-vitals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: metric.name,
        value: metric.value,
        id: metric.id || '',
        rating: metric.rating || 'unknown',
        delta: metric.delta || 0,
        navigationType: metric.navigationType || 'unknown',
        // Additional context
        url: window.location.pathname,
        timestamp: Date.now(),
      }),
      // Don't block on this request
      keepalive: true,
    }).catch((error) => {
      // Silently fail - don't impact user experience
      if (process.env.NODE_ENV === 'development') {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to report Web Vital', { errorMessage });
      }
    });
  });

  // This component doesn't render anything
  return null;
}
