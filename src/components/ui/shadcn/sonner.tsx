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
      richColors
      icons={{
        success: <CircleCheck className="h-4 w-4" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <OctagonX className="h-4 w-4" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'group relative data-[styled=true]:!w-[min(400px,calc(100vw-24px))] data-[styled=true]:!rounded-xl data-[styled=true]:!border data-[styled=true]:!pl-4 data-[styled=true]:!pr-10 data-[styled=true]:!py-3.5 data-[styled=true]:!shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)] data-[styled=true]:!backdrop-blur-xl data-[styled=false]:!p-0 data-[styled=false]:!border-0 data-[styled=false]:!bg-transparent data-[styled=false]:!shadow-none data-[styled=false]:!w-auto data-[styled=false]:!overflow-visible',
          success: '!border-emerald-200 !bg-emerald-50/95 !text-emerald-950',
          error: '!border-rose-200 !bg-rose-50/95 !text-rose-950',
          warning: '!border-amber-200 !bg-amber-50/95 !text-amber-950',
          info: '!border-sky-200 !bg-sky-50/95 !text-sky-950',
          title: '!text-sm !font-semibold !leading-5',
          description: '!mt-0.5 !text-sm !leading-5 !text-current !opacity-75',
          icon: '!self-start !mt-0.5',
          closeButton:
            '!right-2.5 !top-2.5 !left-auto !translate-x-0 !translate-y-0 !h-6 !w-6 !rounded-md !border !border-border/70 !bg-background/90 !text-muted-foreground !opacity-100 hover:!text-foreground hover:!bg-muted !pointer-events-auto flex items-center justify-center cursor-pointer shadow-2xs transition-all',
          actionButton: '!rounded-md !bg-slate-900 !text-white hover:!bg-slate-700',
          cancelButton: '!rounded-md !bg-white/70 !text-slate-700 hover:!bg-white',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
