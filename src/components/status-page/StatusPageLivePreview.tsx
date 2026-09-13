'use client';

import { useMemo } from 'react';
import StatusPageLivePreviewBase, {
  type StatusPageLivePreviewProps,
} from './StatusPageLivePreviewBase';
import { resolveStatusPageCustomCss } from '@/lib/status-pages/theme-custom-css';

export * from './StatusPageLivePreviewBase';

/**
 * Normalizes appearance compatibility before entering the device/ShadowRoot preview shell.
 *
 * The public renderer resolves legacy template CSS through the same helper. Doing that here keeps
 * preview and published output identical when a page still carries CSS from the retired template
 * gallery, while preserving genuine Advanced CSS as the final override for every curated theme.
 */
export default function StatusPageLivePreview(props: StatusPageLivePreviewProps) {
  const { previewData } = props;
  const originalCustomCss = previewData.branding?.customCss;
  const resolvedCustomCss = resolveStatusPageCustomCss(
    previewData.branding?.themeId,
    originalCustomCss
  );

  const normalizedPreviewData = useMemo(() => {
    if (typeof originalCustomCss !== 'string' || originalCustomCss === resolvedCustomCss) {
      return previewData;
    }

    return {
      ...previewData,
      branding: {
        ...previewData.branding,
        customCss: resolvedCustomCss,
      },
    };
  }, [originalCustomCss, previewData, resolvedCustomCss]);

  return <StatusPageLivePreviewBase {...props} previewData={normalizedPreviewData} />;
}
