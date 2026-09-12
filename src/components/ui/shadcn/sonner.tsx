'use client';

import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      position="top-right"
      visibleToasts={3}
      gap={8}
      offset="20px"
      mobileOffset="12px"
      closeButton
      icons={{
        success: (
          <div
            data-testid="toast-icon-badge"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--toast-success-icon-border)] bg-[var(--toast-success-icon-bg)] text-[var(--toast-success-icon-fg)]"
          >
            <CircleCheck className="h-4 w-4" />
          </div>
        ),
        info: (
          <div
            data-testid="toast-icon-badge"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--toast-info-icon-border)] bg-[var(--toast-info-icon-bg)] text-[var(--toast-info-icon-fg)]"
          >
            <Info className="h-4 w-4" />
          </div>
        ),
        warning: (
          <div
            data-testid="toast-icon-badge"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--toast-warning-icon-border)] bg-[var(--toast-warning-icon-bg)] text-[var(--toast-warning-icon-fg)]"
          >
            <TriangleAlert className="h-4 w-4" />
          </div>
        ),
        error: (
          <div
            data-testid="toast-icon-badge"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--toast-error-icon-border)] bg-[var(--toast-error-icon-bg)] text-[var(--toast-error-icon-fg)]"
          >
            <OctagonX className="h-4 w-4" />
          </div>
        ),
        loading: (
          <div
            data-testid="toast-icon-badge"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-muted/60 text-muted-foreground"
          >
            <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          </div>
        ),
      }}
      toastOptions={{
        classNames: {
          toast:
            'group relative flex items-start gap-2.5 ' +
            'data-[styled=true]:!w-[min(360px,calc(100vw-24px))] data-[styled=true]:!min-w-[320px] data-[styled=true]:!max-w-[380px] ' +
            'data-[styled=true]:!rounded-xl data-[styled=true]:!border data-[styled=true]:!border-[var(--toast-border)] ' +
            'data-[styled=true]:!bg-[var(--toast-bg)] data-[styled=true]:!text-[var(--toast-fg)] ' +
            'data-[styled=true]:!p-3.5 data-[styled=true]:!pr-10 ' +
            'data-[styled=true]:!shadow-[var(--toast-shadow)] data-[styled=true]:!backdrop-blur-xl ' +
            'before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-[3px] before:rounded-r-full ' +
            'data-[styled=false]:!p-0 data-[styled=false]:!border-0 data-[styled=false]:!bg-transparent data-[styled=false]:!shadow-none data-[styled=false]:!w-auto data-[styled=false]:!overflow-visible ' +
            'break-words motion-reduce:transition-none',
          success: 'before:!bg-[var(--toast-success-accent)]',
          error:
            'before:!bg-[var(--toast-error-accent)] data-[styled=true]:!border-[var(--toast-error-icon-border)]/60',
          warning: 'before:!bg-[var(--toast-warning-accent)]',
          info: 'before:!bg-[var(--toast-info-accent)]',
          title: '!text-sm !font-semibold !leading-5 !text-[var(--toast-fg)]',
          description: '!mt-0.5 !text-[13px] !leading-[18px] !text-[var(--toast-muted)]',
          icon: '!self-start !mt-0',
          closeButton:
            '!right-2.5 !top-2.5 !left-auto !translate-x-0 !translate-y-0 ' +
            '!h-7 !w-7 !rounded-md !border-0 !bg-transparent ' +
            '!text-[var(--toast-muted)] !opacity-60 hover:!opacity-100 hover:!bg-muted/70 hover:!text-[var(--toast-fg)] ' +
            '!pointer-events-auto flex items-center justify-center cursor-pointer ' +
            'after:absolute after:-inset-1.5 after:content-[\'\'] after:pointer-events-auto ' +
            'transition-opacity transition-colors motion-reduce:transition-none',
          actionButton:
            '!rounded-md !text-xs !font-medium !h-7 !px-2.5 !bg-primary !text-primary-foreground hover:!bg-primary/90',
          cancelButton:
            '!rounded-md !text-xs !font-medium !h-7 !px-2.5 !border !border-border !bg-background !text-foreground hover:!bg-muted',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
