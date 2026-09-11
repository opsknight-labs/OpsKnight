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
      visibleToasts={4}
      gap={10}
      offset="20px"
      mobileOffset="12px"
      closeButton
      icons={{
        success: <CircleCheck className="h-4 w-4" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <OctagonX className="h-4 w-4" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'group relative data-[styled=true]:!w-[min(400px,calc(100vw-24px))] data-[styled=true]:!rounded-xl data-[styled=true]:!border data-[styled=true]:!pl-4 data-[styled=true]:!pr-10 data-[styled=true]:!py-3.5 data-[styled=true]:!shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)] data-[styled=true]:!backdrop-blur-xl data-[styled=false]:!p-0 data-[styled=false]:!border-0 data-[styled=false]:!bg-transparent data-[styled=false]:!shadow-none data-[styled=false]:!w-auto data-[styled=false]:!overflow-visible break-words motion-reduce:transition-none',
          success:
            '!border-[var(--toast-success-border)] !bg-[var(--toast-success-bg)] !text-[var(--toast-success-fg)]',
          error:
            '!border-[var(--toast-error-border)] !bg-[var(--toast-error-bg)] !text-[var(--toast-error-fg)]',
          warning:
            '!border-[var(--toast-warning-border)] !bg-[var(--toast-warning-bg)] !text-[var(--toast-warning-fg)]',
          info: '!border-[var(--toast-info-border)] !bg-[var(--toast-info-bg)] !text-[var(--toast-info-fg)]',
          title: '!text-sm !font-semibold !leading-5',
          description: '!mt-0.5 !text-sm !leading-5 !text-current !opacity-75',
          icon: '!self-start !mt-0.5',
          closeButton:
            '!right-2.5 !top-2.5 !left-auto !translate-x-0 !translate-y-0 !h-10 !w-10 !rounded-md !border !border-border/70 !bg-background/90 !text-muted-foreground !opacity-100 hover:!text-foreground hover:!bg-muted !pointer-events-auto flex items-center justify-center cursor-pointer shadow-2xs transition-opacity transition-colors motion-reduce:transition-none',
          actionButton: '!rounded-md !bg-primary !text-primary-foreground hover:!bg-primary/90',
          cancelButton:
            '!rounded-md !border !border-border !bg-card !text-foreground hover:!bg-muted',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
