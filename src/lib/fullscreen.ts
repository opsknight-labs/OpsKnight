/**
 * Cross-browser Fullscreen API helpers.
 *
 * Covers the standard API (Chromium, Firefox, Safari 16.4+), the WebKit-prefixed API used by
 * older Safari and many smart-TV browsers (Tizen, webOS, Fire TV / Android TV WebViews), and the
 * legacy Gecko/MS variants. Callers must invoke `enterFullscreen` from a user gesture.
 */

type VendorElement = HTMLElement & {
  webkitRequestFullscreen?: (options?: unknown) => Promise<void> | void;
  webkitRequestFullScreen?: (options?: unknown) => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type VendorDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitCurrentFullScreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  mozFullScreenEnabled?: boolean;
  msFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitCancelFullScreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

export const FULLSCREEN_CHANGE_EVENTS = [
  'fullscreenchange',
  'webkitfullscreenchange',
  'mozfullscreenchange',
  'MSFullscreenChange',
] as const;

export function getFullscreenElement(doc: Document = document): Element | null {
  const vendor = doc as VendorDocument;
  return (
    doc.fullscreenElement ??
    vendor.webkitFullscreenElement ??
    vendor.webkitCurrentFullScreenElement ??
    vendor.mozFullScreenElement ??
    vendor.msFullscreenElement ??
    null
  );
}

export function isFullscreenSupported(doc: Document = document): boolean {
  const vendor = doc as VendorDocument;
  const element = doc.documentElement as VendorElement;
  const enabled =
    doc.fullscreenEnabled ??
    vendor.webkitFullscreenEnabled ??
    vendor.mozFullScreenEnabled ??
    vendor.msFullscreenEnabled;
  if (enabled === false) return false;
  return Boolean(
    element.requestFullscreen ||
    element.webkitRequestFullscreen ||
    element.webkitRequestFullScreen ||
    element.mozRequestFullScreen ||
    element.msRequestFullscreen
  );
}

/** Resolves true when the element is (or was already) fullscreen. Never throws. */
export async function enterFullscreen(element: HTMLElement): Promise<boolean> {
  if (getFullscreenElement(element.ownerDocument) === element) return true;
  const vendor = element as VendorElement;
  const request =
    element.requestFullscreen ??
    vendor.webkitRequestFullscreen ??
    vendor.webkitRequestFullScreen ??
    vendor.mozRequestFullScreen ??
    vendor.msRequestFullscreen;
  if (!request) return false;
  try {
    // navigationUI: 'hide' asks mobile/TV Chromium to hide its system bars as well.
    await request.call(element, { navigationUI: 'hide' });
  } catch {
    try {
      await request.call(element);
    } catch {
      return false;
    }
  }
  return getFullscreenElement(element.ownerDocument) !== null;
}

export async function exitFullscreen(doc: Document = document): Promise<void> {
  if (!getFullscreenElement(doc)) return;
  const vendor = doc as VendorDocument;
  const exit =
    doc.exitFullscreen ??
    vendor.webkitExitFullscreen ??
    vendor.webkitCancelFullScreen ??
    vendor.mozCancelFullScreen ??
    vendor.msExitFullscreen;
  try {
    await exit?.call(doc);
  } catch {
    // Already exited (e.g. the user pressed Esc or the TV back button).
  }
}
