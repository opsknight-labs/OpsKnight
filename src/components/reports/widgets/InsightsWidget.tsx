'use client';

import { memo } from 'react';
import { Sparkles, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';

type Insight = {
  type: 'positive' | 'negative' | 'neutral';
  text: string;
};

type InsightsWidgetProps = {
  insights: Insight[];
  maxItems?: number;
};

/**
 * InsightsWidget - Display AI-generated insights and recommendations
 */
const InsightsWidget = memo(function InsightsWidget({
  insights,
  maxItems = 5,
}: InsightsWidgetProps) {
  if (!insights || insights.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <Sparkles className="h-6 w-6" />
        <span className="text-sm">No insights available</span>
      </div>
    );
  }

  const displayInsights = insights.slice(0, maxItems);

  // Count by type
  const counts = insights.reduce(
    (acc, insight) => {
      acc[insight.type]++;
      return acc;
    },
    { positive: 0, negative: 0, neutral: 0 }
  );

  return (
    <div className="flex flex-col h-full">
      {/* Summary pills */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {counts.negative > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
            <AlertCircle className="h-3 w-3" />
            {counts.negative} attention
          </span>
        )}
        {counts.positive > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
            <TrendingUp className="h-3 w-3" />
            {counts.positive} positive
          </span>
        )}
        {counts.neutral > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400">
            {counts.neutral} neutral
          </span>
        )}
      </div>

      {/* Insights list */}
      <div className="flex-1 overflow-auto space-y-2">
        {displayInsights.map((insight, idx) => (
          <div
            key={idx}
            className={`p-2 rounded-lg border text-xs ${
              insight.type === 'positive'
                ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                : insight.type === 'negative'
                  ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
                  : 'bg-gray-50 border-gray-200 dark:bg-gray-800/50 dark:border-gray-700'
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-shrink-0 mt-0.5">
                {insight.type === 'positive' ? (
                  <TrendingUp className="h-3 w-3 text-green-600 dark:text-green-400" />
                ) : insight.type === 'negative' ? (
                  <TrendingDown className="h-3 w-3 text-red-600 dark:text-red-400" />
                ) : (
                  <Sparkles className="h-3 w-3 text-gray-500" />
                )}
              </div>
              <p className="flex-1 leading-relaxed">{insight.text}</p>
            </div>
          </div>
        ))}
      </div>

      {insights.length > maxItems && (
        <div className="text-xs text-muted-foreground text-center mt-2 pt-2 border-t">
          Showing {maxItems} of {insights.length} insights
        </div>
      )}
    </div>
  );
});

export default InsightsWidget;
