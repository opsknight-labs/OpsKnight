'use client';

import React, { useEffect, useState } from 'react';

export default function LoginTicker() {
  const [metrics, setMetrics] = useState({
    latency: 24,
    upstream: 'ONLINE',
    nodes: '14/14',
    errorRate: '0.001%',
    throughput: '4.2k rps',
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(prev => ({
        ...prev,
        latency: Math.floor(20 + Math.random() * 15),
        throughput: (4 + Math.random() * 0.5).toFixed(1) + 'k rps',
        errorRate: (Math.random() * 0.005).toFixed(3) + '%',
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed bottom-0 left-0 right-0 h-8 flex items-center justify-center overflow-hidden z-50">
      <div className="flex items-center gap-12 text-[10px] font-mono text-white/40 tracking-widest uppercase select-none animate-marquee whitespace-nowrap">
        {/* Duplicate content for seamless loop if we add marquee animation later, currently just static center for cleanliness */}
        <TickerItem label="System Status" value="OPERATIONAL" color="text-emerald-500" />
        <TickerItem label="Upstream" value={metrics.upstream} />
        <TickerItem label="Latency" value={`${metrics.latency}ms`} />
        <TickerItem label="Active Nodes" value={metrics.nodes} />
        <TickerItem label="Error Rate" value={metrics.errorRate} />
        <TickerItem label="Throughput" value={metrics.throughput} />
        <TickerItem label="Encryption" value="TLS 1.3" />
        <TickerItem label="Region" value="US-EAST-1" />
      </div>
    </div>
  );
}

function TickerItem({
  label,
  value,
  color = 'text-white/60',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-white/20">{label}:</span>
      <span className={color}>{value}</span>
    </div>
  );
}
