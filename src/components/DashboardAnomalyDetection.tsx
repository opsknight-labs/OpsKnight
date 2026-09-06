'use client';

import { useState, useMemo } from 'react';

type AnomalyData = {
  type: 'spike' | 'drop' | 'pattern';
  metric: string;
  value: number;
  expected: number;
  severity: 'low' | 'medium' | 'high';
  message: string;
};

type DashboardAnomalyDetectionProps = {
  currentData: {
    total: number;
    open: number;
    resolved: number;
    acknowledged: number;
  };
  historicalData: Array<{
    date: Date;
    total: number;
    open: number;
    resolved: number;
    acknowledged: number;
  }>;
};

export default function DashboardAnomalyDetection({
  currentData,
  historicalData,
}: DashboardAnomalyDetectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Use useMemo to calculate anomalies derived from props
  const anomalies = useMemo(() => {
    const detected: AnomalyData[] = [];

    if (historicalData.length < 7) return detected;

    // Calculate averages for last 7 days
    const recent7Days = historicalData.slice(-7);
    const avgTotal = recent7Days.reduce((sum, d) => sum + d.total, 0) / recent7Days.length;
    const avgOpen = recent7Days.reduce((sum, d) => sum + d.open, 0) / recent7Days.length;
    const avgResolved = recent7Days.reduce((sum, d) => sum + d.resolved, 0) / recent7Days.length;
    const avgAcknowledged =
      recent7Days.reduce((sum, d) => sum + d.acknowledged, 0) / recent7Days.length;

    const checkAnomaly = (current: number, expected: number, metric: string) => {
      const diff = Math.abs(current - expected);
      // Avoid division by zero
      if (expected === 0) {
        if (current > 0) {
          return {
            type: 'spike' as const,
            metric,
            value: current,
            expected,
            severity: 'high' as const,
            message: `${metric} spiked (new activity, expected 0)`,
          };
        }
        return null;
      }

      const percentChange = (diff / expected) * 100;

      if (percentChange > 50) {
        const isSpike = current > expected;
        return {
          type: isSpike ? ('spike' as const) : ('drop' as const),
          metric,
          value: current,
          expected,
          severity:
            percentChange > 100
              ? ('high' as const)
              : percentChange > 75
                ? ('medium' as const)
                : ('low' as const),
          message: `${metric} ${isSpike ? 'spiked' : 'dropped'} by ${percentChange.toFixed(1)}% (${current} vs expected ${expected.toFixed(0)})`,
        };
      }
      return null;
    };

    const totalAnomaly = checkAnomaly(currentData.total, avgTotal, 'Total Incidents');
    if (totalAnomaly) detected.push(totalAnomaly);

    const openAnomaly = checkAnomaly(currentData.open, avgOpen, 'Open Incidents');
    if (openAnomaly) detected.push(openAnomaly);

    const resolvedAnomaly = checkAnomaly(currentData.resolved, avgResolved, 'Resolved Incidents');
    if (resolvedAnomaly) detected.push(resolvedAnomaly);

    const ackAnomaly = checkAnomaly(
      currentData.acknowledged,
      avgAcknowledged,
      'Acknowledged Incidents'
    );
    if (ackAnomaly) detected.push(ackAnomaly);

    return detected;
  }, [currentData, historicalData]);

  if (anomalies.length === 0) return null;

  const highSeverityCount = anomalies.filter(a => a.severity === 'high').length;
  const mediumSeverityCount = anomalies.filter(a => a.severity === 'medium').length;

  return (
    <div
      className="glass-panel"
      style={{
        background:
          highSeverityCount > 0 ? '#fef2f2' : mediumSeverityCount > 0 ? '#fffbeb' : '#f0f9ff',
        padding: '1rem',
        borderRadius: '8px',
        border: `2px solid ${highSeverityCount > 0 ? '#ef4444' : mediumSeverityCount > 0 ? '#f59e0b' : '#3b82f6'}`,
        marginBottom: '1rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          marginBottom: isExpanded ? '1rem' : 0,
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.5rem' }}>
            {highSeverityCount > 0 ? '🚨' : mediumSeverityCount > 0 ? '⚠️' : '📊'}
          </span>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)' }}>
              Anomaly Detected
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {anomalies.length} unusual pattern{anomalies.length !== 1 ? 's' : ''} found
            </div>
          </div>
        </div>
        <button
          style={{
            background: 'none',
            border: 'none',
            fontSize: '1.2rem',
            cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >
          {isExpanded ? '▼' : '▶'}
        </button>
      </div>

      {isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {anomalies.map((anomaly, index) => (
            <div
              key={index}
              style={{
                padding: '0.75rem',
                background: 'white',
                borderRadius: '6px',
                border: `1px solid ${anomaly.severity === 'high' ? '#ef4444' : anomaly.severity === 'medium' ? '#f59e0b' : '#3b82f6'}`,
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
              }}
            >
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background:
                    anomaly.severity === 'high'
                      ? '#ef4444'
                      : anomaly.severity === 'medium'
                        ? '#f59e0b'
                        : '#3b82f6',
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    marginBottom: '0.25rem',
                  }}
                >
                  {anomaly.metric}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {anomaly.message}
                </div>
              </div>
              <div
                style={{
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  background:
                    anomaly.severity === 'high'
                      ? '#fee2e2'
                      : anomaly.severity === 'medium'
                        ? '#fef3c7'
                        : '#dbeafe',
                  color:
                    anomaly.severity === 'high'
                      ? '#991b1b'
                      : anomaly.severity === 'medium'
                        ? '#92400e'
                        : '#1e40af',
                  fontSize: '0.7rem',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                }}
              >
                {anomaly.severity}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
