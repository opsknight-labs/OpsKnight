'use client';

import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

/**
 * Mobile-only switch whose actual interactive root is a real 44x44 hit
 * target, while the visible track/thumb stay at the compact desktop scale.
 *
 * The shared shadcn `Switch` deliberately isn't reused/resized here: its
 * button *is* the 24px-tall visible track, so wrapping it in a larger
 * decorative box does not enlarge what's actually clickable. Enlarging the
 * shared component itself would also change every desktop settings toggle.
 */
const MobileSwitch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, checked, ...props }, ref) => (
  <SwitchPrimitives.Root
    checked={checked}
    className={cn(
      'peer inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
    ref={ref}
  >
    <span
      aria-hidden="true"
      data-state={checked ? 'checked' : 'unchecked'}
      className="pointer-events-none flex h-6 w-11 items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
    >
      <SwitchPrimitives.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </span>
  </SwitchPrimitives.Root>
));
MobileSwitch.displayName = 'MobileSwitch';

export { MobileSwitch };
