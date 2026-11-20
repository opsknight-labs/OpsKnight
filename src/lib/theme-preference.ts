/**
 * Shared theme-preference contract.
 *
 * The account preference (`User.themePreference`) is the source of truth and
 * follows the user across devices. next-themes keeps a per-browser copy in
 * localStorage so the blocking pre-paint script can apply it before first
 * paint and so tabs stay in sync through the `storage` event.
 */
export const THEME_STORAGE_KEY = 'theme';

export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type ThemePreferenceValue = 'SYSTEM' | 'LIGHT' | 'DARK';

/** Browser chrome (`theme-color`) per painted theme; matches --ui-background. */
export const THEME_CHROME_COLORS = {
  light: '#f8fafc',
  dark: '#09090b',
} as const;

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

export function themeChoiceFromPreference(
  preference: ThemePreferenceValue | null | undefined
): ThemeChoice {
  if (preference === 'LIGHT') return 'light';
  if (preference === 'DARK') return 'dark';
  return 'system';
}

export function preferenceFromThemeChoice(choice: ThemeChoice): ThemePreferenceValue {
  if (choice === 'light') return 'LIGHT';
  if (choice === 'dark') return 'DARK';
  return 'SYSTEM';
}

/**
 * Inline, render-blocking script that applies the signed-in user's account
 * preference before the authenticated shell paints. The preference arrives on
 * the script element's `data-theme-pref` attribute, so the script body is a
 * fixed string with nothing interpolated into it. The DOM is always updated;
 * syncing the browser copy is best-effort, because storage can be blocked.
 * Keep the colours in sync with THEME_CHROME_COLORS and the key with
 * THEME_STORAGE_KEY (pinned by tests/lib/theme-preference.test.ts).
 */
export const ACCOUNT_THEME_SYNC_SCRIPT =
  '(function(){try{var s=document.currentScript,p=s&&s.getAttribute("data-theme-pref");' +
  'if(p!=="system"&&p!=="light"&&p!=="dark")return;' +
  'try{if(localStorage.getItem("theme")!==p)localStorage.setItem("theme",p)}catch(e){}' +
  'var d=document.documentElement,r=p==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;' +
  'd.classList.remove("light","dark");d.classList.add(r);d.style.colorScheme=r;d.setAttribute("data-theme",r);' +
  'var m=document.getElementById("opsknight-runtime-theme-color");if(m)m.setAttribute("content",r==="dark"?"#09090b":"#f8fafc")}catch(e){}})();';

/**
 * Inline script for light-only surfaces reached through a rewrite (custom
 * status-page domains serve `/status/<slug>` at `/`), where the head script
 * cannot tell from `location.pathname` that the page must stay light. It runs
 * at the top of the surface's layout, before any of its content paints.
 */
export const FORCE_LIGHT_THEME_SCRIPT =
  '(function(){try{var d=document.documentElement;d.classList.remove("dark");d.classList.add("light");' +
  'd.style.colorScheme="light";d.setAttribute("data-theme","light");' +
  'var m=document.getElementById("opsknight-runtime-theme-color");if(m)m.setAttribute("content","#f8fafc")}catch(e){}})();';

/**
 * Head script: paints browser/PWA chrome in the right colour before hydration
 * and mirrors the theme to data-theme for legacy selectors. next-themes' own
 * script applies the class; this one only covers what it does not. Routes
 * listed (comma-separated) in the element's `data-light-routes` stay light.
 */
export const CHROME_THEME_BOOTSTRAP_SCRIPT =
  '(function(){try{var e=document.currentScript,l=(e&&e.getAttribute("data-light-routes")||"").split(","),p=location.pathname;' +
  'var pin=l.some(function(x){return x&&(p===x||p.indexOf(x+"/")===0)});' +
  'var s=null;try{s=localStorage.getItem("theme")}catch(t){}' +
  'var dark=!pin&&(s==="dark"||((!s||s==="system")&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches));' +
  'var r=dark?"dark":"light";document.documentElement.setAttribute("data-theme",r);' +
  'var m=document.getElementById("opsknight-runtime-theme-color");if(m)m.setAttribute("content",dark?"#09090b":"#f8fafc")}catch(t){}})();';
