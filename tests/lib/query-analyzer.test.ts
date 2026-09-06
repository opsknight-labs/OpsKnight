import { describe, it, expect } from 'vitest';
import {
    analyzeSlowQuery,
    getQueryOptimizationSuggestions,
    type SLAQueryFilters,
} from '@/lib/query-analyzer';

describe('query-analyzer', () => {
    describe('analyzeSlowQuery', () => {
        it('identifies unfiltered queries as complex', () => {
            const filters: SLAQueryFilters = {};
            const result = analyzeSlowQuery(filters);

            expect(result.recommendations).toContain('Add serviceId or teamId filter to reduce scan scope');
            expect(result.estimatedComplexity).toBeGreaterThanOrEqual(4);
        });

        it('identifies large date ranges', () => {
            const filters: SLAQueryFilters = {
                windowDays: 400,
                serviceId: 'svc-1', // Has filter
            };
            const result = analyzeSlowQuery(filters);

            expect(result.recommendations).toContain(
                'Large date range detected (>365 days). Consider using shorter window or rollup data'
            );
            expect(result.severity).toBe('medium');
        });

        it('identifies all time queries', () => {
            const filters: SLAQueryFilters = {
                includeAllTime: true,
                serviceId: 'svc-1',
            };
            const result = analyzeSlowQuery(filters);

            expect(result.recommendations).toContain(
                '"All time" query detected. Consider using date range filters for better performance'
            );
            expect(result.estimatedComplexity).toBeGreaterThanOrEqual(5);
        });

        it('identifies many services filter', () => {
            const filters: SLAQueryFilters = {
                serviceId: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11'],
            };
            const result = analyzeSlowQuery(filters);

            expect(result.recommendations).toContain(
                'Many services selected. Consider using team-based filtering instead'
            );
        });

        it('returns low severity for simple filtered queries', () => {
            const filters: SLAQueryFilters = {
                serviceId: 'svc-1',
                windowDays: 7,
            };
            const result = analyzeSlowQuery(filters);

            expect(result.recommendations).toHaveLength(0);
            expect(result.severity).toBe('low');
            expect(result.estimatedComplexity).toBe(1);
        });
    });

    describe('getQueryOptimizationSuggestions', () => {
        it('returns array of suggestions', () => {
            const filters: SLAQueryFilters = {
                includeAllTime: true,
            };
            const suggestions = getQueryOptimizationSuggestions(filters);

            expect(Array.isArray(suggestions)).toBe(true);
            expect(suggestions.length).toBeGreaterThan(0);
        });
    });
});
