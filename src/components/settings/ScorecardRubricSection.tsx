import { DEFAULT_SCORECARD_RUBRIC } from '@/lib/business-services/scorecard';
import { getScorecardRubric } from '@/lib/business-services/scorecard-config';
import ScorecardRubricPanel from './ScorecardRubricPanel';

/** Server wrapper: loads the configured scorecard rubric for the admin editor. */
export default async function ScorecardRubricSection() {
  return (
    <ScorecardRubricPanel
      rubric={await getScorecardRubric()}
      defaultRubric={DEFAULT_SCORECARD_RUBRIC}
    />
  );
}
