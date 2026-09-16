/**
 * Neutral video-bridge URL helper. Extracted so both the compat shim
 * (`chatops/war-room`) and the provider-owned provision path can share the
 * same URL contract without `providers/slack` depending on the compat surface.
 */

export function generateBridgeUrl(
  incidentId: string,
  provider: string,
  customTemplate?: string | null
): string | null {
  if (!provider || provider === 'NONE') return null;
  const shortId = incidentId.slice(-8);
  let formattedUrl: string | null = null;
  if (customTemplate && customTemplate.trim()) {
    let urlStr = customTemplate.trim();
    if (!/^https?:\/\//i.test(urlStr)) urlStr = `https://${urlStr}`;
    if (urlStr.includes('{incidentId}'))
      formattedUrl = urlStr.replace(/\{incidentId\}/g, incidentId);
    else formattedUrl = urlStr;
  }
  switch (provider) {
    case 'MICROSOFT_TEAMS':
      return formattedUrl || null;
    case 'JITSI':
      return formattedUrl || `https://meet.jit.si/opsknight-inc-${shortId}`;
    case 'ZOOM':
      return formattedUrl || null;
    case 'GOOGLE_MEET':
      return formattedUrl || `https://meet.google.com/lookup/opsknight-inc-${shortId}`;
    default:
      return formattedUrl || null;
  }
}
