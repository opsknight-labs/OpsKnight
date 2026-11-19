'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import Link from 'next/link';

import { getRoleCapabilities, type AppRole, type Capability } from '@/lib/authorization';
import { canAccessPath } from '@/lib/access/pages';
import { describeRequirement } from '@/lib/access/catalog';
import type { AccessSnapshot } from '@/lib/access/server';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';

type AccessContextValue = {
  snapshot: AccessSnapshot | null;
  capabilities: ReadonlySet<Capability>;
};

const AccessContext = createContext<AccessContextValue>({
  snapshot: null,
  capabilities: new Set(),
});

/**
 * Client view of the person's effective access, hydrated on every server render from the
 * database (never from the session token, which can be stale after a role change).
 * UI hints only: the server re-checks every action.
 */
export function AccessProvider({
  snapshot,
  children,
}: {
  snapshot: AccessSnapshot | null;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ snapshot, capabilities: new Set(snapshot?.capabilities ?? []) }),
    [snapshot]
  );
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  return useContext(AccessContext);
}

/**
 * Effective capabilities from the provider; outside a provider (isolated renders, legacy
 * callers) falls back to the built-in role implied by the caller's flags.
 */
export function useEffectiveCapabilities(fallback: {
  isAdmin?: boolean;
  isAuditor?: boolean;
  isResponderOrAbove?: boolean;
  role?: AppRole | null;
}): ReadonlySet<Capability> {
  const { snapshot, capabilities } = useAccess();
  return useMemo(() => {
    if (snapshot) return capabilities;
    const role: AppRole =
      fallback.role ??
      (fallback.isAdmin
        ? 'ADMIN'
        : fallback.isResponderOrAbove
          ? 'RESPONDER'
          : fallback.isAuditor
            ? 'AUDITOR'
            : 'USER');
    const set = new Set(getRoleCapabilities(role));
    // Admins who are also flagged as auditors (or vice versa) keep both views.
    if (fallback.isAuditor)
      for (const capability of getRoleCapabilities('AUDITOR')) set.add(capability);
    return set;
  }, [
    snapshot,
    capabilities,
    fallback.role,
    fallback.isAdmin,
    fallback.isAuditor,
    fallback.isResponderOrAbove,
  ]);
}

function toList(anyOf: Capability | readonly Capability[]): readonly Capability[] {
  return typeof anyOf === 'string' ? [anyOf] : anyOf;
}

/** True when the person holds at least one of the capabilities. */
export function useCan(anyOf: Capability | readonly Capability[]): boolean {
  const { capabilities } = useAccess();
  return toList(anyOf).some(capability => capabilities.has(capability));
}

export function useCanAccessPath(path: string): boolean {
  const { capabilities } = useAccess();
  return canAccessPath(path, capabilities);
}

/** Renders children only when allowed (or `fallback` otherwise). */
export function Can({
  anyOf,
  children,
  fallback = null,
}: {
  anyOf: Capability | readonly Capability[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useCan(anyOf) ? <>{children}</> : <>{fallback}</>;
}

/**
 * Shows a control to everyone but disables it, with an explanation, for people who lack the
 * permission. Use for primary actions on a page the person can see, so they learn why they
 * can't act and how to get access, instead of the button silently missing.
 *
 *   <PermissionGate anyOf={CAPABILITIES.RUNBOOK_EXECUTE}>
 *     {allowed => <Button disabled={!allowed}>Run</Button>}
 *   </PermissionGate>
 */
export function PermissionGate({
  anyOf,
  allowed: allowedOverride,
  reason,
  mode = 'disable',
  children,
}: {
  anyOf: Capability | readonly Capability[];
  /** Resource-aware decision computed by the server; overrides the capability check. */
  allowed?: boolean;
  /** Custom explanation; defaults to "Requires <roles>". */
  reason?: string;
  mode?: 'disable' | 'hide';
  children: (allowed: boolean) => ReactNode;
}) {
  const hasCapability = useCan(anyOf);
  const allowed = allowedOverride ?? hasCapability;
  if (allowed) return <>{children(true)}</>;
  if (mode === 'hide') return null;
  const explanation = reason ?? `${describeRequirement(toList(anyOf)).summary}.`;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} aria-label={explanation} className="inline-flex cursor-not-allowed">
            <span className="pointer-events-none inline-flex">{children(false)}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p>{explanation}</p>
          <Link href="/settings/access" className="mt-1 inline-block underline">
            Request access
          </Link>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Server-component friendly gate: shows `children` normally when allowed, otherwise renders
 * them inert and dimmed with an explanation tooltip and a link to request access.
 */
export function RestrictedAction({
  allowed,
  anyOf,
  reason,
  children,
}: {
  allowed: boolean;
  anyOf: Capability | readonly Capability[];
  reason?: string;
  children: ReactNode;
}) {
  if (allowed) return <>{children}</>;
  const explanation = reason ?? `${describeRequirement(toList(anyOf)).summary}.`;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-disabled="true"
            aria-label={explanation}
            className="inline-flex cursor-not-allowed opacity-60"
          >
            <span className="pointer-events-none inline-flex" inert>
              {children}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p>{explanation}</p>
          <Link href="/settings/access" className="mt-1 inline-block underline">
            Request access
          </Link>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
