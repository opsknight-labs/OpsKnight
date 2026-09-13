'use client';

import { useState, type ComponentProps } from 'react';
import { Palette, Settings } from 'lucide-react';
import StatusPageConfig from '@/components/StatusPageConfig';
import StatusPageDesignSettings from './StatusPageDesignSettings';
import { cn } from '@/lib/utils';

type StatusPageWorkspaceProps = ComponentProps<typeof StatusPageConfig>;
type Workspace = 'settings' | 'design';

/**
 * Top-level status-page workspace. Design is separated from operational settings so themes and
 * Advanced CSS do not get mixed into the old template/CSS editor.
 */
export default function StatusPageWorkspace(props: StatusPageWorkspaceProps) {
  const [workspace, setWorkspace] = useState<Workspace>('settings');

  return (
    <div className="status-page-workspace bg-background">
      <div className="border-b border-border bg-card px-3 py-2.5 sm:px-4">
        <div
          className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-1"
          role="tablist"
          aria-label="Status page workspace"
        >
          <button
            type="button"
            role="tab"
            aria-selected={workspace === 'settings'}
            onClick={() => setWorkspace('settings')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
              workspace === 'settings'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspace === 'design'}
            onClick={() => setWorkspace('design')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
              workspace === 'design'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Palette className="h-3.5 w-3.5" />
            Design
          </button>
        </div>
      </div>

      {workspace === 'settings' ? (
        <div data-status-page-settings-shell>
          {/* The old template gallery copied entire CSS files into branding.customCss. Hide that
              legacy entry point while preserving every other mature settings control. */}
          <style>{`[data-status-page-settings-shell] [data-tab-id="customization"] { display: none; }`}</style>
          <StatusPageConfig {...props} />
        </div>
      ) : (
        <StatusPageDesignSettings statusPage={props.statusPage} />
      )}
    </div>
  );
}
