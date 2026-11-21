import OpsKnightSquire, { type SquireState } from './OpsKnightSquire';

/** The supplied November 6 Squire artwork, with application-controlled state and motion. */
export default function SquireMascot({
  state = 'idle',
  animated = false,
}: {
  state?: SquireState;
  animated?: boolean;
}) {
  return (
    <OpsKnightSquire state={state} variant="avatar" size="100%" animated={animated} label="" />
  );
}
