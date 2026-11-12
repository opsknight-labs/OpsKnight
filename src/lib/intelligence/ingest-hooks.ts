/**
 * The only intelligence surface ingestion may import. Post-commit hints, plus the bounded, fail-open
 * pre-paging noise-control hook (in-process snapshot, index-backed lookups under one deadline, no
 * model, no network). Ingestion never imports analysis or correlation implementations.
 */
export { signalIntelligenceIncident } from './jobs/wake-publisher';
export {
  evaluateIngestNoiseControls,
  recordIngestNoiseDecision,
  linkStormChild,
  type IngestNoiseDecision,
} from './noise-controls/ingest';
