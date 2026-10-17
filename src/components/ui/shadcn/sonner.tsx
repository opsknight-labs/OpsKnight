'use client';

import { Toaster as Sonner } from 'sonner';
import { useEffectiveTheme } from '@/hooks/use-effective-theme';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ theme: propTheme, className, style, ...props }: ToasterProps) => {
  // Follow the theme the page is painted in. Neither `system` (asks the OS) nor
  // next-themes' `resolvedTheme` (reads storage, ignores forcedTheme) is safe:
  // both rendered dark toasts — with a near-invisible close button — on the
  // forced-light desktop whenever the OS or the mobile toggle preferred dark.
  const effectiveTheme = useEffectiveTheme();

  // Every notification renders its own body (NotificationToast,
  // IncidentAlertToast); the surface, tokens and motion live in
  // src/styles/components/toasts.css, keyed off data-sonner-theme.
  return (
    <Sonner
      theme={propTheme ?? effectiveTheme}
      className={['ok-toaster', className].filter(Boolean).join(' ')}
      style={{ '--width': '372px', ...style } as React.CSSProperties}
      position="top-right"
      visibleToasts={3}
      gap={10}
      offset="20px"
      mobileOffset="12px"
      toastOptions={{ unstyled: true }}
      {...props}
    />
  );
};

export { Toaster };
