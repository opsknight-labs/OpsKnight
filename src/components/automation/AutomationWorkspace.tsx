'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import { getAutomationArea, automationAction } from '@/app/(app)/services/[id]/automation/actions';
import {
  builtinFields,
  emptySnapshot,
  snapshotSchema,
  type Field,
  type Snapshot,
} from '@/lib/automation/contract';
import { compileAutomation, type LintIssue } from '@/lib/automation/compiler';
import { Button } from '@/components/ui/shadcn/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import { AutomationActivity } from './AutomationActivity';
import { AutomationContext } from './AutomationContext';
import { AutomationOverview } from './AutomationOverview';
import { AutomationReviewDialog } from './AutomationReviewDialog';
import { AutomationRules } from './AutomationRules';
import { AutomationTest } from './AutomationTest';
import type { Area, Data } from './presentation-types';
import { AREAS, DRAFT_AREAS, newRule } from './workspace/constants';
import { DisableModeDialog } from './workspace/DisableModeDialog';
import { DraftConflictPanel } from './workspace/DraftConflictPanel';
import { ErrorNotice, GlobalSwitchNotice, RecoveryNotice, UndoNotice } from './workspace/Notices';
import { RemoveFieldDialog } from './workspace/RemoveFieldDialog';
import { SectionNav } from './workspace/SectionNav';
import { SectionPanel } from './workspace/SectionPanel';
import { sumShadowAggregates } from './workspace/shadow-counts';
import { applyAutomationTemplate } from './workspace/templates';
import { useAutomationDraft } from './workspace/useAutomationDraft';
import { useContextAuthoring } from './workspace/useContextAuthoring';
import { useSampleTest } from './workspace/useSampleTest';
import { ValidationSummary } from './workspace/ValidationSummary';
import { WorkspaceHeader } from './workspace/WorkspaceHeader';
import { notify } from '@/lib/toast';
import { InlineNotice } from '@/components/ui/InlineNotice';

type ReviewAction = 'publish' | 'restore' | 'LIVE' | 'activateCandidate';
type RestorableVersion = Data['versions'][number] & { snapshot: Snapshot };

function lint(draft: Snapshot): LintIssue[] {
  try {
    return compileAutomation(draft).issues;
  } catch (err) {
    return [
      {
        level: 'ERROR',
        code: 'INVALID_DRAFT',
        message: err instanceof Error ? err.message : 'Invalid draft',
      },
    ];
  }
}

/** Focuses an element inside `root` once it renders (sections load asynchronously). */
function focusWhenReady(root: HTMLElement | null, find: (root: HTMLElement) => HTMLElement | null) {
  let attempts = 0;
  const tick = () => {
    if (!root?.isConnected) return;
    const target = find(root);
    if (target) target.focus();
    else if (++attempts < 30) setTimeout(tick, 100);
  };
  setTimeout(tick, 0);
}

export default function AutomationWorkspace({
  serviceId,
  mobile = false,
}: {
  serviceId: string;
  mobile?: boolean;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const draggedRule = useRef<string | null>(null);
  const [area, setArea] = useState<Area>('overview');
  const [areaData, setAreaData] = useState<Partial<Record<Area, Data>>>({});
  const [latest, setLatest] = useState<Data | null>(null);
  const [activityPage, setActivityPage] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const announcementTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const notifyAction = useCallback(
    (message: string, tone: 'success' | 'info' | 'error' = 'success', description?: string) => {
      setAnnouncement(message);
      if (tone === 'success') {
        notify.success(message, { description });
      } else if (tone === 'error') {
        notify.error(message, { description });
      } else {
        notify.info(message, { description });
      }

      if (announcementTimeoutRef.current) {
        clearTimeout(announcementTimeoutRef.current);
      }
      announcementTimeoutRef.current = setTimeout(() => {
        setAnnouncement('');
      }, 6000);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (announcementTimeoutRef.current) {
        clearTimeout(announcementTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const keyToArea: Record<string, Area> = {
        '1': 'overview',
        '2': 'context',
        '3': 'rules',
        '4': 'test',
        '5': 'activity',
      };
      const targetArea = keyToArea[e.key];
      if (targetArea) {
        e.preventDefault();
        setArea(targetArea);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const [review, setReview] = useState<ReviewAction | null>(null);
  const [reviewData, setReviewData] = useState<Data | null>(null);
  const [restoreVersion, setRestoreVersion] = useState<RestorableVersion | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [confirmDiscardCandidate, setConfirmDiscardCandidate] = useState(false);
  const [deleteField, setDeleteField] = useState<Field | null>(null);
  const [ruleSearch, setRuleSearch] = useState('');
  const [ruleStateFilter, setRuleStateFilter] = useState('all');
  const [expandedRules, setExpandedRules] = useState<Set<string>>(() => new Set());
  const [traceFilter, setTraceFilter] = useState('ALL');
  const [versionView, setVersionView] = useState<string | null>(null);
  // eslint-disable-next-line security/detect-object-injection -- `area` is a closed union.
  const data = areaData[area] ?? null;
  // Keeps the header populated while a newly selected section loads.
  const status = data ?? latest;

  const {
    draft,
    saveState,
    conflict,
    localCopy,
    undo,
    revision,
    edit,
    save,
    flush,
    receiveServerDraft,
    keepMineAfterConflict,
    discardForServerCopy,
    restoreLocalCopy,
    dismissLocalCopy,
    updateRule,
    updateField,
    move,
    removeRule,
    removeField,
    applyUndo,
  } = useAutomationDraft({
    serviceId,
    ownerId: status?.recoveryOwnerId ?? null,
    canEdit: !!status?.canEdit,
    onError: setError,
  });
  const context = useContextAuthoring({
    serviceId,
    draft,
    edit,
    onError: setError,
    onNotify: notifyAction,
  });
  const tester = useSampleTest({
    serviceId,
    draft,
    providerSample: context.providerSample,
    integrationType: context.integrationType,
    setBusy,
    onError: setError,
  });

  const loadSeqRef = useRef(0);

  const load = useCallback(
    async (nextArea: Area) => {
      const seq = ++loadSeqRef.current;
      try {
        const next = await getAutomationArea(serviceId, nextArea, activityPage);
        if (seq !== loadSeqRef.current) return;
        if (
          next.activeVersion?.snapshot &&
          !snapshotSchema.safeParse(next.activeVersion.snapshot).success
        )
          throw new Error(
            `Version ${next.activeVersion.versionNumber} failed integrity validation and cannot be rendered`
          );
        receiveServerDraft(next.draft, DRAFT_AREAS.includes(nextArea));
        setAreaData(previous => ({ ...previous, [nextArea]: next }));
        setLatest(next);
        setError('');
        return next;
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not load automation');
      }
    },
    [serviceId, activityPage, receiveServerDraft]
  );

  useEffect(() => {
    const seq = ++loadSeqRef.current;
    void (async () => {
      try {
        const next = await getAutomationArea(serviceId, area, activityPage);
        if (seq !== loadSeqRef.current) return;
        if (
          next.activeVersion?.snapshot &&
          !snapshotSchema.safeParse(next.activeVersion.snapshot).success
        )
          throw new Error(
            `Version ${next.activeVersion.versionNumber} failed integrity validation and cannot be rendered`
          );
        receiveServerDraft(next.draft, DRAFT_AREAS.includes(area));
        setAreaData(previous => ({ ...previous, [area]: next }));
        setLatest(next);
        setError('');
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not load automation');
      }
    })();
  }, [area, serviceId, activityPage, receiveServerDraft]);

  const command = useCallback(
    async (
      input: Record<string, unknown>,
      expectedActiveVersionId: string | null,
      successMessage: string
    ) => {
      setBusy(true);
      setError('');
      try {
        if (!(await flush())) return false;
        if (conflict) {
          setError('Resolve the draft conflict before continuing.');
          return false;
        }
        const response = await automationAction({
          ...input,
          serviceId,
          expectedActiveVersionId,
          ...(input.action === 'publish'
            ? {
                expectedRevision: revision.current,
                expectedCandidateVersionId:
                  reviewData?.candidateVersionId ?? status?.candidateVersionId ?? null,
              }
            : {}),
        });
        if (!response.ok) {
          // A stale active version or draft revision: refresh so a retry uses current state.
          if (response.code === 'CONFLICT') await load(area);
          setError(response.error);
          notifyAction(response.error, 'error');
          return false;
        }
        notifyAction(successMessage, 'success');
        await load(area);
        return true;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Automation request failed';
        setError(errMsg);
        notifyAction(errMsg, 'error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [flush, conflict, serviceId, revision, load, area, reviewData, status, notifyAction]
  );

  const openReview = useCallback(
    (action: ReviewAction) => {
      setBusy(true);
      void load('rules')
        .then(loaded => {
          if (loaded) {
            setReviewData(loaded);
            setReview(action);
          }
        })
        .finally(() => setBusy(false));
    },
    [load]
  );
  const publish = useCallback(() => openReview('publish'), [openReview]);
  const startActivateCandidate = useCallback(() => openReview('activateCandidate'), [openReview]);
  const discardPendingCandidate = async () => {
    const candidateId = status?.candidateVersionId;
    if (!candidateId) return;
    setBusy(true);
    setError('');
    try {
      const response = await automationAction({
        action: 'discardCandidate',
        serviceId,
        expectedCandidateVersionId: candidateId,
      });
      if (!response.ok) {
        setError(response.error);
        notifyAction(response.error, 'error');
        return;
      }
      setConfirmDiscardCandidate(false);
      notifyAction('Candidate discarded.', 'info');
      await load('overview');
    } catch (cause) {
      const errMsg = cause instanceof Error ? cause.message : 'Could not discard candidate';
      setError(errMsg);
      notifyAction(errMsg, 'error');
    } finally {
      setBusy(false);
    }
  };
  const restoreDraft = async (versionId: string) => {
    setBusy(true);
    setError('');
    try {
      if (!(await flush())) return;
      const response = await automationAction({
        action: 'restoreDraft',
        serviceId,
        sourceVersionId: versionId,
        expectedRevision: revision.current,
      });
      if (!response.ok) {
        setError(response.error);
        notifyAction(response.error, 'error');
        return;
      }
      discardForServerCopy();
      setArea('rules');
      await load('rules');
      notifyAction('Historical version restored as an editable draft.', 'success');
    } catch (cause) {
      const errMsg = cause instanceof Error ? cause.message : 'Could not restore draft';
      setError(errMsg);
      notifyAction(errMsg, 'error');
    } finally {
      setBusy(false);
    }
  };
  const changeMode = useCallback(
    (mode: string) => {
      if (mode === 'LIVE') openReview('LIVE');
      else if (mode === 'DISABLED' && status?.mode !== 'DISABLED') setConfirmDisable(true);
      else
        void command(
          { action: 'mode', mode },
          status?.activeVersionId ?? null,
          `Automation mode set to ${mode}.`
        );
    },
    [openReview, command, status?.mode, status?.activeVersionId]
  );
  const confirmDisableMode = () => {
    void command(
      { action: 'mode', mode: 'DISABLED' },
      status?.activeVersionId ?? null,
      'Automation mode set to DISABLED.'
    ).then(success => {
      if (success) setConfirmDisable(false);
    });
  };
  const restore = useCallback(
    (version: RestorableVersion) => {
      setRestoreVersion(version);
      openReview('restore');
    },
    [openReview]
  );
  const closeReview = useCallback(() => {
    setReview(null);
    setRestoreVersion(null);
  }, []);
  const confirmReview = (
    acknowledgeNoShadow: boolean,
    acknowledgeShadowErrors: boolean,
    acknowledgeMaterialDifferences: boolean
  ) => {
    void command(
      review === 'LIVE'
        ? { action: 'mode', mode: 'LIVE', acknowledgeNoShadow, acknowledgeShadowErrors }
        : review === 'activateCandidate'
          ? {
              action: 'activateCandidate',
              expectedCandidateVersionId: reviewData?.candidateVersionId,
              acknowledgeNoShadow,
              acknowledgeShadowErrors,
              acknowledgeMaterialDifferences,
            }
          : {
              action: 'publish',
              ...(review === 'restore' ? { sourceVersionId: restoreVersion?.id } : {}),
            },
      reviewData?.activeVersionId ?? null,
      review === 'LIVE' || review === 'activateCandidate'
        ? 'Automation mode set to LIVE.'
        : review === 'restore'
          ? 'Version restored as a new published version.'
          : 'New automation version published.'
    ).then(success => {
      if (success) closeReview();
    });
  };

  const issues = useMemo(() => lint(draft), [draft]);
  const errorCount = useMemo(() => issues.filter(i => i.level === 'ERROR').length, [issues]);
  const fields = useMemo(() => [...builtinFields, ...draft.fields], [draft.fields]);
  const counts = useMemo(
    () =>
      review === 'LIVE'
        ? sumShadowAggregates(reviewData?.aggregates, reviewData?.activeVersionId ?? null)
        : review === 'activateCandidate'
          ? sumShadowAggregates(reviewData?.candidateAggregates)
          : sumShadowAggregates(data?.aggregates),
    [review, reviewData, data]
  );
  const reviewBefore = useMemo(
    () => snapshotSchema.parse(reviewData?.activeVersion?.snapshot ?? emptySnapshot),
    [reviewData]
  );
  const reviewSnapshot = useMemo(
    () =>
      review === 'LIVE' && reviewData?.activeVersion
        ? snapshotSchema.parse(reviewData.activeVersion.snapshot)
        : review === 'activateCandidate' && reviewData?.candidateVersion?.snapshot
          ? snapshotSchema.parse(reviewData.candidateVersion.snapshot)
          : review === 'restore' && restoreVersion
            ? snapshotSchema.parse(restoreVersion.snapshot)
            : draft,
    [review, reviewData, restoreVersion, draft]
  );
  const publishBlockedReason = conflict
    ? 'Resolve the draft conflict before publishing.'
    : errorCount
      ? `Fix ${errorCount} blocking ${errorCount === 1 ? 'issue' : 'issues'} before publishing.`
      : null;

  const openRule = useCallback(
    (ruleId: string) => {
      const name = draft.rules.find(rule => rule.id === ruleId)?.name;
      setRuleSearch('');
      setRuleStateFilter('all');
      setExpandedRules(previous => (mobile ? new Set([ruleId]) : new Set([...previous, ruleId])));
      setArea('rules');
      if (name)
        focusWhenReady(
          rootRef.current,
          root =>
            Array.from(root.querySelectorAll<HTMLElement>('button[aria-label]')).find(
              button => button.getAttribute('aria-label') === `Configure ${name}`
            ) ?? null
        );
    },
    [draft.rules, mobile]
  );
  const openContext = useCallback(() => setArea('context'), []);
  const viewAffectedRules = (ruleIds: string[]) => {
    setRuleSearch('');
    setRuleStateFilter('all');
    setArea('rules');
    setExpandedRules(new Set(ruleIds));
    setDeleteField(null);
  };
  const createTemplate = useCallback(
    (kind: string) => {
      const outcome = applyAutomationTemplate(draft, kind);
      if ('error' in outcome) {
        setError(outcome.error);
        notifyAction(outcome.error, 'error');
        return;
      }
      edit(outcome.snapshot);
      notifyAction(
        'Automation template applied',
        'success',
        'Starter rules and context fields added to draft.'
      );
      setArea('rules');
    },
    [draft, edit, notifyAction]
  );
  const reloadTheirs = () => {
    discardForServerCopy();
    void load(DRAFT_AREAS.includes(area) ? area : 'rules');
  };

  const section = AREAS.find(item => item.id === area)!;
  const retryable = saveState === 'Save failed — retry' || saveState === 'Offline';

  return (
    <section ref={rootRef} aria-label="Service automation" className="min-w-0 space-y-4">
      <AutomationReviewDialog
        key={`${review}:${review === 'LIVE' ? reviewData?.activeVersionId : review === 'activateCandidate' ? reviewData?.candidateVersionId : (restoreVersion?.id ?? status?.activeVersionId)}`}
        action={review}
        policies={reviewData?.policies}
        destinations={reviewData?.destinations}
        before={reviewBefore}
        mode={status?.mode ?? 'DISABLED'}
        snapshot={reviewSnapshot}
        version={
          review === 'activateCandidate'
            ? (reviewData?.candidateVersion?.versionNumber ?? null)
            : ((review === 'LIVE' ? reviewData : status)?.activeVersion?.versionNumber ?? null)
        }
        candidateFallbacks={
          review === 'activateCandidate'
            ? (reviewData?.candidateAggregates?.reduce((sum, row) => sum + row.fallbacks, 0) ?? 0)
            : (counts?.fallbacks ?? 0)
        }
        enabled={status?.enabled ?? false}
        counts={counts}
        busy={busy}
        error={error}
        onCancel={closeReview}
        onConfirm={confirmReview}
      />
      <DisableModeDialog
        open={confirmDisable}
        currentMode={status?.mode ?? 'DISABLED'}
        busy={busy}
        onCancel={() => setConfirmDisable(false)}
        onConfirm={confirmDisableMode}
      />
      <AlertDialog
        open={confirmDiscardCandidate}
        onOpenChange={open => !open && !busy && setConfirmDiscardCandidate(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard candidate?</AlertDialogTitle>
            <AlertDialogDescription>
              Stop staged shadow evaluation. The active LIVE version stays in place.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep candidate</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void discardPendingCandidate()}
            >
              Discard candidate
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RemoveFieldDialog
        field={deleteField}
        rules={draft.rules}
        onCancel={() => setDeleteField(null)}
        onViewRules={viewAffectedRules}
        onConfirm={field => {
          removeField(field);
          notifyAction(`Context field "${field.label}" removed`, 'info');
          setDeleteField(null);
        }}
      />
      <p aria-live="polite" className="sr-only">
        {saveState === 'Saved' ? 'All changes saved' : ''}
      </p>
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <WorkspaceHeader
          status={status}
          saveState={saveState}
          busy={busy}
          publishBlockedReason={publishBlockedReason}
          onPublish={publish}
          onModeChange={changeMode}
        />
        {announcement && (
          <InlineNotice
            tone="success"
            title={announcement}
            onDismiss={() => setAnnouncement('')}
            className="animate-in fade-in slide-in-from-top-2 duration-200"
          />
        )}
        {status && !status.enabled && <GlobalSwitchNotice />}
        {error && (
          <ErrorNotice message={error} onRetrySave={retryable ? () => void save() : undefined} />
        )}
        {conflict && (
          <DraftConflictPanel
            serviceId={serviceId}
            draft={draft}
            onError={setError}
            onKeepMine={keepMineAfterConflict}
            onReloadTheirs={reloadTheirs}
          />
        )}
        {localCopy && status?.canEdit && (
          <RecoveryNotice onReview={restoreLocalCopy} onDismiss={dismissLocalCopy} />
        )}
        {area !== 'rules' && (
          <ValidationSummary
            issues={issues}
            rules={draft.rules}
            onOpenRule={openRule}
            onOpenContext={openContext}
          />
        )}
        <SectionNav area={area} onSelect={setArea} errorCount={errorCount} />
        {undo && <UndoNotice label={undo.label} disabled={busy} onUndo={applyUndo} />}
        <SectionPanel
          id={`automation-${area}`}
          title={section.label}
          description={section.description}
        >
          {!data &&
            (error ? (
              <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  This section could not be loaded.
                </p>
                <Button variant="outline" className="h-10" onClick={() => void load(area)}>
                  <RotateCcw aria-hidden="true" />
                  Try again
                </Button>
              </div>
            ) : (
              <p className="flex items-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading automation…
              </p>
            ))}
          {data && area === 'overview' && (
            <AutomationOverview
              data={data}
              counts={counts}
              traceFilter={traceFilter}
              setTraceFilter={setTraceFilter}
              setArea={setArea}
              onActivateCandidate={startActivateCandidate}
              onDiscardCandidate={() => setConfirmDiscardCandidate(true)}
            />
          )}
          {data && area === 'context' && (
            <AutomationContext
              data={data}
              draft={draft}
              contextSearch={context.contextSearch}
              setContextSearch={context.setContextSearch}
              updateField={updateField}
              setDeleteField={setDeleteField}
              integrationType={context.integrationType}
              setIntegrationType={context.setIntegrationType}
              handleIntegrationTypeChange={context.handleIntegrationTypeChange}
              selectObservedField={context.selectObservedField}
              observedPath={context.observedPath}
              setObservedPath={context.setObservedPath}
              selectedSource={context.selectedSource}
              setSelectedSource={context.setSelectedSource}
              selectedIntegrationType={context.selectedIntegrationType}
              setSelectedIntegrationType={context.setSelectedIntegrationType}
              discoveries={context.discoveries}
              setDiscoveries={context.setDiscoveries}
              fieldLabel={context.fieldLabel}
              setFieldLabel={context.setFieldLabel}
              fieldType={context.fieldType}
              setFieldType={context.setFieldType}
              values={context.values}
              setValues={context.setValues}
              addField={context.addField}
              advanced={context.advanced}
              setAdvanced={context.setAdvanced}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              serviceId={serviceId}
              providerSample={context.providerSample}
              setProviderSample={context.setProviderSample}
              analyze={context.analyze}
            />
          )}
          {data && area === 'rules' && (
            <AutomationRules
              data={data}
              draft={draft}
              fields={fields}
              ruleSearch={ruleSearch}
              setRuleSearch={setRuleSearch}
              ruleStateFilter={ruleStateFilter}
              setRuleStateFilter={setRuleStateFilter}
              expandedRules={expandedRules}
              setExpandedRules={setExpandedRules}
              draggedRule={draggedRule}
              edit={edit}
              updateRule={updateRule}
              move={move}
              removeRule={removeRule}
              mobile={mobile}
              createTemplate={createTemplate}
              newRule={newRule}
              issues={issues}
              onOpenRule={openRule}
              onOpenContext={openContext}
            />
          )}
          {data && area === 'test' && (
            <AutomationTest
              data={data}
              integrationId={tester.integrationId}
              setIntegrationId={tester.setIntegrationId}
              setIntegrationType={context.setIntegrationType}
              sample={tester.sample}
              setSample={tester.setSample}
              providerSample={context.providerSample}
              setProviderSample={context.setProviderSample}
              busy={busy}
              runTest={tester.runTest}
              result={tester.result}
            />
          )}
          {data && area === 'activity' && (
            <AutomationActivity
              serviceId={serviceId}
              data={data}
              activityPage={activityPage}
              setActivityPage={setActivityPage}
              versionView={versionView}
              setVersionView={setVersionView}
              busy={busy}
              onRestore={restore}
              onRestoreDraft={restoreDraft}
            />
          )}
        </SectionPanel>
      </fieldset>
    </section>
  );
}
