'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Phone: native-feeling safe-area sheet. Tablet/desktop: centered dialog.
        'fixed inset-x-0 bottom-0 z-50 grid max-h-[calc(100dvh-env(safe-area-inset-top,0px)-0.75rem)] w-full gap-4 overflow-y-auto rounded-t-3xl border border-border bg-background p-5 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] shadow-2xl duration-200',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom-8 data-[state=open]:slide-in-from-bottom-8',
        'sm:left-[50%] sm:top-[50%] sm:bottom-auto sm:max-h-[min(85dvh,52rem)] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-xl sm:p-6 sm:pb-6',
        'sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%] sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]',
        className
      )}
      {...props}
    >
      <div aria-hidden="true" className="mx-auto -mt-1 h-1 w-10 rounded-full bg-border sm:hidden" />
      {children}
      <DialogPrimitive.Close
        className="absolute right-3.5 top-3.5 z-20 flex h-8.5 w-8.5 items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 active:bg-zinc-300 text-zinc-700 hover:text-zinc-950 border border-zinc-300/80 shadow-2xs transition-all duration-150 active:scale-95 cursor-pointer dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-200 dark:hover:text-white dark:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none"
        aria-label="Close dialog"
        title="Close (Esc)"
      >
        <X className="h-5 w-5 shrink-0" strokeWidth={2.5} />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-0 sm:space-x-2',
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('pr-10 text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
