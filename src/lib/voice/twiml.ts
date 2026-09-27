function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function buildVoiceTwiml(input: {
  message: string;
  gatherUrl?: string;
  requireAck: boolean;
}): string {
  const message = xmlEscape(input.message.trim().slice(0, 600));
  if (!input.requireAck || !input.gatherUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${message}</Say><Hangup/></Response>`;
  }
  const gatherUrl = xmlEscape(input.gatherUrl);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather action="${gatherUrl}" method="POST" numDigits="1" timeout="8"><Say>${message} Press 1 to acknowledge this incident.</Say></Gather><Say>No acknowledgement was received. The incident remains active.</Say><Hangup/></Response>`;
}

export function voiceCallbackTwiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xmlEscape(message)}</Say><Hangup/></Response>`;
}
