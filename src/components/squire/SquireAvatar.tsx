import { cn } from '@/lib/utils';
import SquireMascot from './SquireMascot';
import type { SquireState } from './OpsKnightSquire';

/**
 * The assistant's face. Decorative only: the name is always shown in text next to it. Motion is opt-in and
 * still suppressed for people who ask their system for reduced motion.
 */
export default function SquireAvatar({
  animated = false,
  size = 'sm',
  state = 'idle',
}: {
  animated?: boolean;
  size?: 'xs' | 'sm' | 'md';
  state?: SquireState;
}) {
  return (
    <span
      aria-hidden="true"
      data-avatar="SQUIRE"
      className={cn(
        'inline-block shrink-0',
        size === 'md' ? 'h-8 w-8' : size === 'xs' ? 'h-6 w-6' : 'h-7 w-7'
      )}
    >
      <SquireMascot state={state} animated={animated} />
    </span>
  );
}
