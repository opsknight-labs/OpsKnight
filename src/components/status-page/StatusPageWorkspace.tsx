'use client';

import type { ComponentProps } from 'react';
import StatusPageConfig from '@/components/StatusPageConfig';
import StatusPageDesignSettings from './StatusPageDesignSettings';

type StatusPageWorkspaceProps = ComponentProps<typeof StatusPageConfig>;

/**
 * Unified Status Page settings workspace.
 *
 * Appearance now lives inside Settings instead of a separate top-level Design workspace. The old
 * template/customization entry point remains hidden because it copied legacy CSS payloads into
 * branding.customCss; the new Appearance studio above it owns curated themes + Advanced CSS and
 * shows the actual V3 preview while editing.
 */
export default function StatusPageWorkspace(props: StatusPageWorkspaceProps) {
  return (
    <div className="status-page-workspace bg-background">
      <StatusPageDesignSettings
        statusPage={props.statusPage}
        liveSnapshot={props.liveSnapshot ?? null}
      />

      <div data-status-page-settings-shell>
        <style>{`[data-status-page-settings-shell] [data-tab-id="customization"] { display: none; }`}</style>
        <StatusPageConfig {...props} />
      </div>
    </div>
  );
}
