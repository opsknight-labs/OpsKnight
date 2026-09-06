'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';

/**
 * LoginAnimation Component
 *
 * "Active Threat Response System"
 * - Visualization: Holographic map of infrastructure.
 * - Narrative: System detects an issue (Red), Auto-remediates (Beam), and Resolves (Green).
 * - Aesthetic: Premium, glassmorphic, incident-focused.
 */
export default function LoginAnimation() {
  const [mounted, setMounted] = useState(false);
  const [activeIncident, setActiveIncident] = useState<number | null>(null); // Index of node having incident
  const [isFixing, setIsFixing] = useState(false); // Beam active
  const [nodes, setNodes] = useState([
    { id: 0, label: 'API_GATEWAY', angle: 0, status: 'healthy', radius: 140 },
    { id: 1, label: 'AUTH_SERVICE', angle: 72, status: 'healthy', radius: 140 },
    { id: 2, label: 'DB_PRIMARY', angle: 144, status: 'healthy', radius: 140 },
    { id: 3, label: 'PAYMENTS', angle: 216, status: 'healthy', radius: 140 },
    { id: 4, label: 'WORKERS', angle: 288, status: 'healthy', radius: 140 },
  ]);

  // Live UTC Clock
  const [currentTime, setCurrentTime] = useState('');

  // Animated Uptime Counter
  const [uptime, setUptime] = useState(99.95);

  useEffect(() => {
    setMounted(true);

    // Simulation Loop
    const interval = setInterval(() => {
      // Randomly pick a node to "fail"
      const victimIdx = Math.floor(Math.random() * 5);
      setActiveIncident(victimIdx);

      // 1. Trigger Incident
      setNodes(prev => prev.map((n, i) => (i === victimIdx ? { ...n, status: 'critical' } : n)));

      // 2. Start Fixing (Visual Beam) after 1s
      setTimeout(() => {
        setIsFixing(true);
      }, 1000);

      // 3. Resolve Incident after 2.5s
      setTimeout(() => {
        setNodes(prev => prev.map((n, i) => (i === victimIdx ? { ...n, status: 'healthy' } : n)));
        setIsFixing(false);
        setActiveIncident(null);
      }, 2500);
    }, 8000); // Every 8 seconds (slower for less distraction)

    return () => clearInterval(interval);
  }, []);

  // Live Clock Effect
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(now.toISOString().slice(11, 19) + ' UTC');
    };
    updateClock();
    const clockInterval = setInterval(updateClock, 1000);
    return () => clearInterval(clockInterval);
  }, []);

  // Animated Uptime Effect
  useEffect(() => {
    const uptimeInterval = setInterval(() => {
      setUptime(prev => {
        if (prev >= 99.99) return 99.95;
        return Math.min(99.99, prev + 0.01);
      });
    }, 500);
    return () => clearInterval(uptimeInterval);
  }, []);

  // Parallax Effect State with throttling
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (rafRef.current) return; // Skip if already scheduled
    rafRef.current = requestAnimationFrame(() => {
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = (e.clientY / window.innerHeight) * 2 - 1;
      setMousePos({ x, y });
      rafRef.current = null;
    });
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [handleMouseMove]);

  if (!mounted) return null;

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden cursor-crosshair select-none">
      {/* 1. Deep Space Grid Background with Parallax */}
      <div
        className="absolute inset-0 bg-[linear-gradient(rgba(6,182,212,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.05)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_100%)] transition-transform duration-100 ease-out"
        style={{ transform: `translate(${mousePos.x * 20}px, ${mousePos.y * 20}px)` }}
      />

      {/* Floating Particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-cyan-500/30 animate-[float-particle_15s_ease-in-out_infinite]"
            style={{
              left: `${(i * 5) % 100}%`,
              top: `${(i * 7 + 20) % 100}%`,
              animationDelay: `${i * 0.7}s`,
              animationDuration: `${12 + (i % 8)}s`,
            }}
          />
        ))}
      </div>

      {/* 2. HUD Corners - Filling the Void */}
      {/* Top Left: System ID */}
      <div className="absolute top-12 left-12 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 bg-cyan-500 animate-pulse" />
          <span className="text-[10px] font-mono font-bold text-cyan-400 tracking-widest">
            SENTINEL_CORE_V4
          </span>
        </div>
        <div className="h-[1px] w-24 bg-cyan-500/30" />
        <span className="text-[9px] text-cyan-500/50 font-mono">LIVE_TELEMETRY_STREAM</span>
      </div>

      {/* Top Right: Uptime / Clock */}
      <div className="absolute top-12 right-12 text-right">
        <span className="block text-[10px] font-mono text-cyan-500/70 tracking-widest">UPTIME</span>
        <div className="flex items-center justify-end gap-2">
          <span className="text-xl font-mono text-cyan-400 font-bold tracking-widest leading-none">
            {uptime.toFixed(2)}%
          </span>
        </div>
        <div className="text-[9px] font-mono text-cyan-500/50 mt-1">{currentTime}</div>
      </div>

      {/* Bottom Left: Coordinates */}
      <div className="absolute bottom-12 left-12 font-mono text-[9px] text-cyan-500/40 space-y-1">
        <div className="flex gap-4">
          <span>LAT: 34.0522 N</span>
          <span>LNG: 118.2437 W</span>
        </div>
        <div className="flex gap-2 items-center">
          <span>NODE: US-WEST-1</span>
          <span className="animate-pulse text-emerald-500">● ONLINE</span>
        </div>
      </div>

      {/* Bottom Right: Network Traffic */}
      <div className="absolute bottom-12 right-12 text-right">
        <div className="flex flex-col items-end gap-1">
          <span className="text-[9px] font-mono text-cyan-500/60 uppercase tracking-widest">
            Net Throughput
          </span>
          <div className="flex items-end gap-[2px] h-8">
            {[4, 6, 3, 7, 5, 8, 4, 6, 3].map((h, i) => (
              <div
                key={i}
                className="w-1 bg-cyan-500/40 animate-pulse"
                style={{ height: `${h * 10}%`, animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Background Ambience */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.05)_0%,transparent_70%)]" />

      {/* Background Terminal: Ping Simulation (Locked to Center) */}
      <div
        className="absolute flex items-center justify-center z-0 pointer-events-none transition-transform duration-75 ease-out"
        style={{ transform: `translate(${mousePos.x * -10}px, ${mousePos.y * -10}px)` }}
      >
        <div className="w-[600px] h-[400px] opacity-100 mask-image-[radial-gradient(circle,black_40%,transparent_100%)]">
          <TerminalPing />
        </div>
      </div>

      {/* Central Connectivity Mesh */}
      <div
        className="relative h-[400px] w-[400px] flex items-center justify-center z-10 transition-transform duration-300 ease-out"
        style={{ transform: `translate(${mousePos.x * 5}px, ${mousePos.y * 5}px)` }}
      >
        {/* Rotating Hexagon Field */}
        <div className="absolute inset-0 animate-[spin_60s_linear_infinite] opacity-20">
          <svg viewBox="0 0 400 400" className="h-full w-full">
            <circle
              cx="200"
              cy="200"
              r="140"
              className="fill-none stroke-cyan-500/30 stroke-dashed"
            />
            <circle cx="200" cy="200" r="190" className="fill-none stroke-cyan-500/10" />

            {/* Added Extra Rings for Density */}
            <circle
              cx="200"
              cy="200"
              r="240"
              className="fill-none stroke-cyan-500/5 stroke-dotted"
            />
          </svg>
        </div>

        {/* The Core: Sentinel Eye */}
        <div className="z-20 flex h-20 w-20 items-center justify-center rounded-full bg-slate-950 border border-cyan-500/50 shadow-[0_0_30px_rgba(6,182,212,0.2)] animate-[pulse-glow_3s_ease-in-out_infinite]">
          <div
            className={`h-3 w-3 rounded-full bg-cyan-400 shadow-[0_0_15px_#22d3ee] transition-all duration-300 ${activeIncident !== null ? 'bg-rose-500 shadow-rose-500 scale-125 animate-ping' : 'animate-[pulse_2s_ease-in-out_infinite]'}`}
          />
          {/* Scanning Beam */}
          <div className="absolute inset-0 animate-[spin_4s_linear_infinite] rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,transparent_270deg,rgba(6,182,212,0.2)_360deg)]" />
        </div>

        {/* Nodes */}
        {nodes.map((node, i) => (
          <ServiceNode
            key={node.id}
            {...node}
            isTarget={activeIncident === i}
            isFixing={isFixing && activeIncident === i}
          />
        ))}
      </div>

      {/* Terminal Status - Status Badge */}
      <div className="absolute bottom-24 lg:bottom-12 left-0 right-0 flex justify-center z-20">
        <div className="glass-panel px-4 py-2 rounded-full border border-white/10 bg-black/40 backdrop-blur-md flex items-center gap-3 shadow-[0_0_20px_rgba(0,0,0,0.5)]">
          <div
            className={`h-2 w-2 rounded-full ${activeIncident !== null ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`}
          />
          <span className="text-[10px] font-mono tracking-widest text-white/90 uppercase">
            {activeIncident !== null
              ? `INCIDENT DETECTED: ${nodes[activeIncident].label}`
              : 'SYSTEM SECURE • MONITORING ACTIVE'}
          </span>
        </div>
      </div>

      {/* CRT Scanline Overlay */}
      <div className="absolute inset-0 z-50 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[size:100%_2px,3px_100%] opacity-20" />
      <div className="absolute inset-0 z-50 pointer-events-none bg-[radial-gradient(circle,transparent_50%,rgba(0,0,0,0.4)_100%)]" />
    </div>
  );
}

function ServiceNode({ label, angle, status, radius, isTarget, isFixing }: any) {
  // Calculate Position (Fixed Angle)
  // We strictly position them using styles to avoid rotation issues
  const rad = (angle * Math.PI) / 180;
  const x = Math.cos(rad) * radius; // Center is 0,0 relative to container
  const y = Math.sin(rad) * radius;

  // Status Styles
  const isCrit = status === 'critical';
  const colorClass = isCrit
    ? 'border-rose-500 bg-rose-500/10 text-rose-200 shadow-rose-900/50'
    : 'border-cyan-500/30 bg-slate-950/80 text-cyan-200 shadow-cyan-900/20';
  const dotColor = isCrit ? 'bg-rose-500' : 'bg-cyan-400';

  return (
    <>
      {/* Connection Line to Center */}
      {isFixing && (
        <div
          className="absolute top-1/2 left-1/2 h-[2px] bg-gradient-to-r from-cyan-400 to-transparent origin-left z-0 animate-pulse"
          style={{
            width: `${radius}px`,
            transform: `rotate(${angle}deg)`,
            marginTop: '-1px',
          }}
        />
      )}

      {/* The Node */}
      <div
        className={`absolute z-10 flex flex-col items-center justify-center transition-all duration-500`}
        style={{
          top: '50%',
          left: '50%',
          transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
        }}
      >
        <div
          className={`relative flex items-center gap-2 rounded-lg border px-3 py-1.5 backdrop-blur-md shadow-lg transition-colors duration-300 ${colorClass}`}
        >
          <div
            className={`h-1.5 w-1.5 rounded-full shadow-[0_0_8px_currentColor] ${dotColor} ${isCrit ? 'animate-ping' : ''}`}
          />
          <span className="text-[9px] font-bold tracking-wider">{label}</span>

          {/* Active Mitigation Badge */}
          {isFixing && (
            <div className="absolute -top-3 -right-2 px-1.5 py-0.5 bg-emerald-500 text-[8px] text-black font-bold rounded animate-bounce">
              FIXING
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TerminalPing() {
  const [lines, setLines] = useState<string[]>([]);
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initial header simulating real terminal startup
    setLines([
      'root@ops-knight:~# ping -c 999 opsknight.com',
      'PING opsknight.com (104.21.55.2) 56(84) bytes of data.',
    ]);

    let seq = 1;
    const interval = setInterval(() => {
      setLines(prev => {
        const newLines = [...prev];
        // Keep max 15 lines to stay within view but allow scrolling feel
        if (newLines.length > 15) newLines.shift();

        const time = (12 + Math.random() * 8).toFixed(1);
        newLines.push(`64 bytes from 104.21.55.2: icmp_seq=${seq} ttl=58 time=${time} ms`);
        seq++;
        return newLines;
      });
    }, 1000); // Standard ping interval is 1s

    return () => clearInterval(interval);
  }, []);

  // Auto-scroll effect
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col justify-center items-center h-full w-full font-mono text-xs leading-relaxed text-emerald-500/90 overflow-hidden text-center"
      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
    >
      {lines.map((line, i) => (
        <div key={i} className="whitespace-nowrap">
          {line}
        </div>
      ))}
      <div className="animate-pulse bg-emerald-500 h-4 w-2.5 mt-1" />
    </div>
  );
}
