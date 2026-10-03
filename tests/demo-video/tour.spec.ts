import { test } from '@playwright/test';
import { DemoDirector } from './helpers/demo-director';
import { playOpeningScene } from './scenes/opening';
import { playDashboardScene } from './scenes/dashboard';
import { playIncidentsScene } from './scenes/incidents';
import { playSchedulesScene } from './scenes/schedules';
import { playEscalationScene } from './scenes/escalation';
import { playServicesScene } from './scenes/services';
import { playTeamsScene } from './scenes/teams';
import { playChatOpsScene } from './scenes/chatops';
import { playNotificationsScene } from './scenes/notifications';
import { playStatusPageScene } from './scenes/status-page';
import { playReportsScene } from './scenes/reports';
import { playAnalyticsScene } from './scenes/analytics';
import { playPostmortemsScene } from './scenes/postmortems';
import { playIntegrationsScene } from './scenes/integrations';
import { playSettingsScene } from './scenes/settings';
import { playHealthScene } from './scenes/health';
import { playEndCardScene } from './scenes/end-card';

test('execute automated master product tour', async ({ page }) => {
  test.setTimeout(360_000); // 6 minutes max timeout for the ~3.5 min tour

  const director = new DemoDirector(page);
  await director.init();

  console.log('[tour.spec] Starting Master Product Tour recording...');

  // 1. Opening
  await playOpeningScene(director);

  // 2. Command Center
  await playDashboardScene(director);

  // 3. Incidents
  await playIncidentsScene(director);

  // 4. Schedules
  await playSchedulesScene(director);

  // 5. Escalation
  await playEscalationScene(director);

  // 6. Services
  await playServicesScene(director);

  // 7. Teams
  await playTeamsScene(director);

  // 8. ChatOps
  await playChatOpsScene(director);

  // 9. Notifications & Paging
  await playNotificationsScene(director);

  // 10. Status Pages
  await playStatusPageScene(director);

  // 11. Reports & Executive Dashboards
  await playReportsScene(director);

  // 12. Analytics
  await playAnalyticsScene(director);

  // 13. Postmortems & Action Items
  await playPostmortemsScene(director);

  // 14. Integrations
  await playIntegrationsScene(director);

  // 15. Administration / Settings
  await playSettingsScene(director);

  // 16. Operations / Health Center
  await playHealthScene(director);

  // 17. End Card
  await playEndCardScene(director);

  await director.finalize();
  console.log('[tour.spec] Master Product Tour completed successfully!');
});
