import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { runbookReadWhere } from '@/lib/authorization-filters';
import { actorHasCapability, type AuthorizationActor } from '@/lib/authorization-policy';
import { redactSecrets } from '../../ai/redact';
import type { EvidenceSnapshot } from '../evidence';
import { formatWhen } from './reads';

/** Asking to change the runbook rather than read it: answered with where to do it. */
const CHANGE =
  /\b(add|edit|update|change|modify|write|fill|remove|delete|rename|reorder|publish)\b/;
const PUBLISH = /\bpublish/;

const clean = (value: unknown, max: number) =>
  typeof value === 'string' ? redactSecrets(value).replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Step names, types and descriptions only; configuration never leaves the editor. */
function stepLines(definition: unknown): string[] {
  const raw =
    definition && typeof definition === 'object' && !Array.isArray(definition)
      ? (definition as { steps?: unknown }).steps
      : undefined;
  return (Array.isArray(raw) ? raw : []).slice(0, 25).map((step, index) => {
    const value = (step && typeof step === 'object' ? step : {}) as Record<string, unknown>;
    const type = clean(value.type, 40).toLowerCase().replace(/_/g, ' ');
    const description = clean(value.description, 200);
    return `${index + 1}. ${clean(value.name, 200) || 'Unnamed step'}${type ? ` (${type})` : ''}${description ? ` — ${description}` : ''}`;
  });
}

/**
 * "What does this runbook do?", "publish this runbook", "add the needed steps" on a runbook page: about that
 * runbook, read under the person's visibility. Draft steps follow the runbook editor's rule: only someone
 * who may manage runbooks sees them. Null when the runbook is not readable.
 */
export async function runbookPageAnswer(
  actor: AuthorizationActor,
  runbookId: string,
  question: string,
  timeZone: string,
  collect?: (source: EvidenceSnapshot) => void
): Promise<string | null> {
  const row = await prisma.runbook.findFirst({
    where: { AND: [{ id: runbookId, archivedAt: null }, runbookReadWhere(actor)] },
    select: {
      id: true,
      name: true,
      description: true,
      updatedAt: true,
      publishedVersion: { select: { version: true, definition: true, publishedAt: true } },
      draftVersion: { select: { version: true, definition: true } },
    },
  });
  if (!row) return null;
  collect?.({
    kind: 'runbook',
    id: row.id,
    label: row.name,
    data: { id: row.id, name: row.name, updatedAt: row.updatedAt },
  });
  const manage = actorHasCapability(actor, CAPABILITIES.RUNBOOK_MANAGE);
  const draft = manage ? row.draftVersion : null;
  const published = row.publishedVersion;
  const link = `/runbooks/${row.id}`;
  const status = published
    ? `Published v${published.version}${row.draftVersion && manage ? `; draft v${row.draftVersion.version} has unpublished changes` : ''}.`
    : row.draftVersion
      ? 'Draft only: not published yet, so it cannot be run.'
      : 'No version yet: it has no steps to run.';
  const steps = (version: { version: number; definition: unknown } | null, label: string) => {
    if (!version) return [];
    const lines = stepLines(version.definition);
    return [`### Steps (${label} v${version.version})`, lines.join('\n') || 'No steps yet.'];
  };
  const shown = [...steps(published, 'published'), ...steps(draft, 'draft')];
  const lines = [
    `## Runbook: ${clean(row.name, 120)}`,
    clean(row.description, 280),
    `${status} Last updated ${formatWhen(row.updatedAt, timeZone)}.`,
    ...shown,
    !published && row.draftVersion && !manage
      ? 'Its draft steps are visible only to people who can manage runbooks.'
      : '',
  ];
  if (CHANGE.test(question)) {
    const publish = PUBLISH.test(question);
    lines.unshift(
      publish
        ? !row.draftVersion
          ? `There is no draft to publish${published ? `; v${published.version} is already published` : ''}. ${link}`
          : actorHasCapability(actor, CAPABILITIES.RUNBOOK_PUBLISH)
            ? `I can't publish from chat. Open ${link} and choose **Publish draft** after reviewing the steps.`
            : `I can't publish from chat, and publishing needs the runbook publish permission, which you don't have. Ask a runbook publisher to review ${link}.`
        : `I can't edit runbook steps in basic mode. Open the editor at ${link} to add or change steps${manage ? '' : ' (editing needs the runbook manage permission)'}. With AI turned on, Squire can draft steps for you to review before anything is saved.`
    );
  }
  lines.push(link);
  return lines.filter(Boolean).join('\n\n');
}
