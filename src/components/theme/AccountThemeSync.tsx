import {
  ACCOUNT_THEME_SYNC_SCRIPT,
  themeChoiceFromPreference,
  type ThemePreferenceValue,
} from '@/lib/theme-preference';

/**
 * Applies the signed-in user's saved appearance before the authenticated shell
 * paints, so a preference chosen on another device never flashes the wrong
 * theme. Rendered once at the top of each authenticated layout.
 */
export default function AccountThemeSync({ preference }: { preference: ThemePreferenceValue }) {
  return (
    <script
      data-theme-pref={themeChoiceFromPreference(preference)}
      dangerouslySetInnerHTML={{ __html: ACCOUNT_THEME_SYNC_SCRIPT }}
    />
  );
}
