-- War-room capture (M4): timeline kind for captured channel messages, on its own as enum additions must be.
ALTER TYPE "IncidentEventType" ADD VALUE IF NOT EXISTS 'CHAT_MESSAGE';
