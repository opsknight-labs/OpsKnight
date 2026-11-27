'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';

const ago = (seconds: number) =>
  seconds < 5 ? 'just now' : seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;

/**
 * Re-renders the server page every `seconds` while the tab is visible, and right after it returns.
 * Shows when the data was last loaded (`renderedAt`, from the server render) and lets the viewer pause.
 */
export default function AutoRefresh({
  seconds = 30,
  renderedAt,
}: {
  seconds?: number;
  /** When the server rendered the data on screen (epoch ms); a refresh hands back a new one. */
  renderedAt?: number;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (paused) return;
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = window.setInterval(tick, seconds * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, seconds, paused]);

  useEffect(() => {
    if (renderedAt === undefined) return;
    const clock = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(clock);
  }, [renderedAt]);

  if (renderedAt === undefined) return null;
  const age = Math.max(0, Math.round((now - renderedAt) / 1000));
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="tabular-nums" suppressHydrationWarning>
        {paused ? 'Paused · ' : ''}Updated {ago(age)}
      </span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        // A stable name plus aria-pressed, like the follow toggle.
        aria-pressed={paused}
        aria-label="Pause live updates"
        title={paused ? 'Resume live updates' : 'Pause live updates'}
        onClick={() => {
          if (paused) router.refresh();
          setPaused(!paused);
        }}
      >
        {paused ? (
          <Play className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Pause className="h-3.5 w-3.5" aria-hidden />
        )}
      </Button>
    </div>
  );
}
