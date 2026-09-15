-- Unified ChatOps: durable per-provider fan-out for war-room events.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WAR_ROOM_PROVIDER_EVENT';
