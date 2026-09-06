import 'server-only';
import { logger } from './logger';

/**
 * Query Analyzer - Provides recommendations for slow SLA queries
 *
 * Analyzes filter parameters and provides actionable recommendations
 * for optimizing query performance.
 */

export interface QueryAnalysisResult {
    recommendations: string[];
    severity: 'low' | 'medium' | 'high';
    estimatedComplexity: number; // 1-10 scale
}

export interface SLAQueryFilters {
    serviceId?: string | string[];
    teamId?: string | string[];
    assigneeId?: string | null;
    windowDays?: number;
    includeAllTime?: boolean;
    startDate?: Date;
    endDate?: Date;
}

/**
 * Analyze SLA query filters and provide optimization recommendations
 */
export function analyzeSlowQuery(filters: SLAQueryFilters): QueryAnalysisResult {
    const recommendations: string[] = [];
    let complexity = 1;

    // Check for unfiltered queries
    if (!filters.serviceId && !filters.teamId && !filters.assigneeId) {
        recommendations.push('Add serviceId or teamId filter to reduce scan scope');
        complexity += 3;
    }

    // Check for large date ranges
    const windowDays = filters.windowDays || 7;
    if (windowDays > 365) {
        recommendations.push('Large date range detected (>365 days). Consider using shorter window or rollup data');
        complexity += 3;
    } else if (windowDays > 90) {
        recommendations.push('Consider using rollup data for queries spanning >90 days');
        complexity += 2;
    }

    // Check for "all time" queries
    if (filters.includeAllTime) {
        recommendations.push('"All time" query detected. Consider using date range filters for better performance');
        complexity += 4;
    }

    // Check for multi-value filters
    if (Array.isArray(filters.serviceId) && filters.serviceId.length > 10) {
        recommendations.push('Many services selected. Consider using team-based filtering instead');
        complexity += 1;
    }

    if (Array.isArray(filters.teamId) && filters.teamId.length > 5) {
        recommendations.push('Many teams selected. Consider reducing scope or using pagination');
        complexity += 1;
    }

    // Determine severity based on complexity
    let severity: 'low' | 'medium' | 'high' = 'low';
    if (complexity >= 7) {
        severity = 'high';
    } else if (complexity >= 4) {
        severity = 'medium';
    }

    return {
        recommendations,
        severity,
        estimatedComplexity: Math.min(10, complexity),
    };
}

/**
 * Log query analysis for monitoring dashboards
 */
export function logQueryAnalysis(
    filters: SLAQueryFilters,
    queryDuration: number,
    incidentCount: number
): void {
    const analysis = analyzeSlowQuery(filters);

    if (queryDuration > 5000 || analysis.severity !== 'low') {
        logger.info('[SLA] Query analysis', {
            duration: queryDuration,
            incidentCount,
            analysis: {
                severity: analysis.severity,
                complexity: analysis.estimatedComplexity,
                recommendationCount: analysis.recommendations.length,
            },
            recommendations: analysis.recommendations.slice(0, 3), // Top 3 recommendations
        });
    }
}

/**
 * Get query optimization suggestions as formatted string (for API responses)
 */
export function getQueryOptimizationSuggestions(filters: SLAQueryFilters): string[] {
    const { recommendations } = analyzeSlowQuery(filters);
    return recommendations;
}
