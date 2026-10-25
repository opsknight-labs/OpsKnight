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
  if (typeof doc === 'undefined') return null;
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
  if (typeof doc === 'undefined') return false;
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
  if (typeof document === 'undefined') return false;
  const doc = element.ownerDocument || document;
  if (getFullscreenElement(doc) !== null) return true;

  const vendor = element as VendorElement;
  const request =
    element.requestFullscreen ??
    vendor.webkitRequestFullscreen ??
    vendor.webkitRequestFullScreen ??
    vendor.mozRequestFullScreen ??
    vendor.msRequestFullscreen;

  if (!request) {
    // If element doesn't have it, try documentElement as fallback
    const rootRequest =
      doc.documentElement.requestFullscreen ??
      (doc.documentElement as VendorElement).webkitRequestFullscreen;
    if (!rootRequest) return false;
    try {
      const res = rootRequest.call(doc.documentElement);
      if (res instanceof Promise) await res;
    } catch {
      return false;
    }
  } else {
    try {
      const res = request.call(element);
      if (res instanceof Promise) await res;
    } catch {
      // Fallback to documentElement if element-level fullscreen is rejected
      try {
        const rootRequest =
          doc.documentElement.requestFullscreen ??
          (doc.documentElement as VendorElement).webkitRequestFullscreen;
        if (rootRequest) {
          const res = rootRequest.call(doc.documentElement);
          if (res instanceof Promise) await res;
        } else {
          return false;
        }
      } catch {
        return false;
      }
    }
  }

  // Check immediately
  if (getFullscreenElement(doc) !== null) return true;

  // For browsers that transition asynchronously (WebKit/Safari), wait for event or state change
  return new Promise<boolean>(resolve => {
    let resolved = false;
    const finish = (result: boolean) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(result);
      }
    };

    const onChange = () => {
      finish(getFullscreenElement(doc) !== null);
    };

    const timer = setTimeout(() => {
      finish(getFullscreenElement(doc) !== null);
    }, 600);

    const cleanup = () => {
      clearTimeout(timer);
      for (const event of FULLSCREEN_CHANGE_EVENTS) {
        doc.removeEventListener(event, onChange);
        element.removeEventListener(event, onChange);
      }
    };

    for (const event of FULLSCREEN_CHANGE_EVENTS) {
      doc.addEventListener(event, onChange, { once: true });
      element.addEventListener(event, onChange, { once: true });
    }
  });
}

export async function exitFullscreen(doc: Document = document): Promise<void> {
  if (typeof doc === 'undefined') return;
  const vendor = doc as VendorDocument;
  const exit =
    doc.exitFullscreen ??
    vendor.webkitExitFullscreen ??
    vendor.webkitCancelFullScreen ??
    vendor.mozCancelFullScreen ??
    vendor.msExitFullscreen;
  try {
    const res = exit?.call(doc);
    if (res instanceof Promise) await res;
  } catch {
    // Already exited (e.g. the user pressed Esc or the TV back button).
  }
}
