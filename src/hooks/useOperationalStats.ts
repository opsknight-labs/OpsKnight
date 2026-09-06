import { useEffect, useState } from 'react';

type StatsResponse = {
  activeIncidentsCount: number;
  criticalIncidentsCount: number;
  mediumIncidentsCount: number;
  lowIncidentsCount: number;
  isClipped: boolean;
  retentionDays: number;
};

export function useOperationalStats() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchStats() {
      try {
        const res = await fetch('/api/sidebar-stats');
        if (!res.ok) throw new Error('Failed to fetch stats');
        const data = await res.json();
        if (mounted) {
          setStats(data);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Unknown error'));
          setLoading(false);
        }
      }
    }

    // Initial fetch
    fetchStats();

    // Poll every 30 seconds
    const interval = setInterval(fetchStats, 30000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return {
    activeCount: stats?.activeIncidentsCount ?? 0,
    criticalCount: stats?.criticalIncidentsCount ?? 0,
    mediumCount: stats?.mediumIncidentsCount ?? 0,
    lowCount: stats?.lowIncidentsCount ?? 0,
    loading,
    error,
    hasLiveStats: stats !== null,
  };
}
