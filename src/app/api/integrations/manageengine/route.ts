import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import {
  transformManageEngineToEvent,
  parseManageEnginePayload,
  ManageEngineEvent,
} from '@/lib/integrations/manageengine';

export const POST = createIntegrationRoute<ManageEngineEvent>(
  'MANAGEENGINE',
  transformManageEngineToEvent,
  {
    signatureProvider: 'generic',
    parsePayload: parseManageEnginePayload,
  }
);
