'use server';

import { z } from 'zod';
import {
  addNote,
  addWatcher,
  removeWatcher,
  updateIncidentDescription,
  updateIncidentStatus,
} from '@/app/(app)/incidents/actions';

const incidentIdSchema = z.string().trim().min(1).max(191);
const noteSchema = z.string().trim().min(1).max(10_000);
const watcherIdSchema = z.string().trim().min(1).max(191);
const watcherRoleSchema = z.string().trim().min(1).max(64);
const descriptionSchema = z.string().max(50_000);

function incidentId(value: string) {
  return incidentIdSchema.parse(value);
}

export async function addIncidentDetailNote(incidentIdValue: string, formData: FormData) {
  const parsedIncidentId = incidentId(incidentIdValue);
  const content = noteSchema.parse(formData.get('content'));
  await addNote(parsedIncidentId, content);
}

export async function acknowledgeIncidentDetail(incidentIdValue: string) {
  await updateIncidentStatus(incidentId(incidentIdValue), 'ACKNOWLEDGED');
}

export async function reopenIncidentDetail(incidentIdValue: string) {
  await updateIncidentStatus(incidentId(incidentIdValue), 'OPEN');
}

export async function suppressIncidentDetail(incidentIdValue: string) {
  await updateIncidentStatus(incidentId(incidentIdValue), 'SUPPRESSED');
}

export async function addIncidentDetailWatcher(incidentIdValue: string, formData: FormData) {
  const parsedIncidentId = incidentId(incidentIdValue);
  const watcherId = watcherIdSchema.parse(formData.get('watcherId'));
  const role = watcherRoleSchema.parse(formData.get('watcherRole'));
  await addWatcher(parsedIncidentId, watcherId, role);
}

export async function removeIncidentDetailWatcher(incidentIdValue: string, formData: FormData) {
  const parsedIncidentId = incidentId(incidentIdValue);
  const watcherId = watcherIdSchema.parse(formData.get('watcherMemberId'));
  await removeWatcher(parsedIncidentId, watcherId);
}

export async function updateIncidentDetailDescription(
  incidentIdValue: string,
  description: string
) {
  await updateIncidentDescription(
    incidentId(incidentIdValue),
    descriptionSchema.parse(description)
  );
}
