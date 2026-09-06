'use client';

import React from 'react';
import { Sparkles, AlertTriangle, CheckCircle, Copy } from 'lucide-react';

interface SmartSummaryProps {
  metrics: {
    mtta: number | null;
    mttr: number | null;
    activeIncidents: number;
    ackCompliance: number | null;
    resolveCompliance: number | null;
    highUrgencyRate: number;
    totalIncidents: number;
  };
  windowDays: number;
  trendSeries: any[];
}

export default function SmartSummary({ metrics, windowDays, trendSeries }: SmartSummaryProps) {
  // 1. Generate Insights
  const insights: { type: 'good' | 'bad' | 'neutral'; text: string }[] = [];

  // Volume Analysis
  if (metrics.totalIncidents > 5) {
    if (metrics.highUrgencyRate > 30) {
      insights.push({
        type: 'bad',
        text: `High urgency load (${metrics.highUrgencyRate.toFixed(0)}% of volume) is likely straining the team.`,
      });
    } else {
      insights.push({
        type: 'good',
        text: `Healthy operational mix with only ${metrics.highUrgencyRate.toFixed(0)}% high urgency incidents.`,
      });
    }
  }

  // Performance Analysis
  if (metrics.mtta && metrics.mtta > 15) {
    insights.push({
      type: 'bad',
      text: `Response time (MTTA) is averaging ${metrics.mtta.toFixed(0)}m, exceeding the 15m target.`,
    });
  } else if (metrics.mtta) {
    insights.push({
      type: 'good',
      text: `Response time is excellent, averaging ${metrics.mtta.toFixed(1)}m.`,
    });
  }

  // Compliance Analysis
  if (
    metrics.ackCompliance !== null &&
    metrics.resolveCompliance !== null &&
    (metrics.ackCompliance < 90 || metrics.resolveCompliance < 90)
  ) {
    insights.push({
      type: 'bad',
      text: `SLA compliance is at risk (Ack: ${metrics.ackCompliance.toFixed(0)}%, Resolve: ${metrics.resolveCompliance.toFixed(0)}%).`,
    });
  }

  // Trend Analysis (Simple slope check of last day vs first day avg)
  if (trendSeries.length > 2) {
    const firstHalf = trendSeries
      .slice(0, Math.floor(trendSeries.length / 2))
      .reduce((acc, curr) => acc + curr.count, 0);
    const secondHalf = trendSeries
      .slice(Math.floor(trendSeries.length / 2))
      .reduce((acc, curr) => acc + curr.count, 0);
    if (secondHalf > firstHalf * 1.5) {
      insights.push({
        type: 'neutral',
        text: `Incident volume is trending upwards in the second half of this period.`,
      });
    }
  }

  if (insights.length === 0) {
    insights.push({
      type: 'neutral',
      text: 'Operations are steady with no significant anomalies detected.',
    });
  }

  const copyToClipboard = () => {
    const text = `Weekly Operations Summary:\n${insights.map(i => `- ${i.text}`).join('\n')}`;
    navigator.clipboard.writeText(text);
    alert('Summary copied to clipboard');
  };

  return (
    <div className="glass-panel p-5 mb-6 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-purple-500 to-blue-500" />

      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-lg flex items-center gap-2">
              Operational Intelligence
              <span className="text-xs font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                AI Generated
              </span>
            </h3>
            <p className="text-xs text-muted-foreground">Analysis of last {windowDays} days</p>
          </div>
        </div>
        <button
          onClick={copyToClipboard}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 bg-secondary/50 hover:bg-secondary px-2 py-1 rounded transition-colors"
        >
          <Copy className="w-3 h-3" /> Copy
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {insights.map((insight, idx) => (
          <div
            key={idx}
            className="flex items-start gap-3 p-3 rounded-md bg-background/40 border border-border/40 hover:bg-background/60 transition-colors"
          >
            {insight.type === 'good' && (
              <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
            )}
            {insight.type === 'bad' && (
              <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
            )}
            {insight.type === 'neutral' && (
              <Sparkles className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
            )}
            <p className="text-sm text-foreground/90 leading-snug">{insight.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
