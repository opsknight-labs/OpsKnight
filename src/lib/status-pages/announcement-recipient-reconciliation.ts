export interface AnnouncementRecipient {
  id: string;
}

/**
 * Select recipients who still need the corrected generation after an earlier
 * generation partially reached providers. Provider-accepted recipients are
 * historical truth and must not receive a duplicate blast.
 */
export function selectAnnouncementRecipientsNeedingReplacement<T extends AnnouncementRecipient>(
  recipients: readonly T[],
  providerAcceptedRecipientIds: ReadonlySet<string>
): T[] {
  return recipients.filter(recipient => !providerAcceptedRecipientIds.has(recipient.id));
}
