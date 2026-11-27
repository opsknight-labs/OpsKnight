-- A daily objective snapshot taken before a full window of data exists is stored as PARTIAL,
-- not as a final AVAILABLE result.
ALTER TYPE "ObjectiveDataState" ADD VALUE IF NOT EXISTS 'PARTIAL';
