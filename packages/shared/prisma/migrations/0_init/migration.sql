-- Migration 0_init — SQLite schema
-- Matches schema.dev.prisma (String-typed enums, no JSON type)

CREATE TABLE IF NOT EXISTS "Claim" (
    "id"               TEXT NOT NULL PRIMARY KEY,
    "claimNumber"      TEXT NOT NULL,
    "patientName"      TEXT NOT NULL,
    "patientDob"       TEXT NOT NULL,
    "patientId"        TEXT NOT NULL,
    "insuranceId"      TEXT NOT NULL,
    "providerId"       TEXT NOT NULL,
    "providerName"     TEXT NOT NULL,
    "dateOfService"    TEXT NOT NULL,
    "diagnosis"        TEXT,
    "treatmentDetails" TEXT,
    "totalAmount"      REAL NOT NULL,
    "currency"         TEXT NOT NULL DEFAULT 'USD',
    "documentPath"     TEXT,
    "rawOcrText"       TEXT,
    "icdCodes"         TEXT,
    "fraudScore"       REAL,
    "fraudFlags"       TEXT,
    "paymentData"      TEXT,
    "verificationData" TEXT,
    "status"           TEXT NOT NULL DEFAULT 'RECEIVED',
    "priority"         TEXT NOT NULL DEFAULT 'NORMAL',
    "metadata"         TEXT,
    "createdAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "AgentTask" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "claimId"     TEXT NOT NULL,
    "agentName"   TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'PENDING',
    "input"       TEXT,
    "output"      TEXT,
    "errorMsg"    TEXT,
    "retryCount"  INTEGER NOT NULL DEFAULT 0,
    "maxRetries"  INTEGER NOT NULL DEFAULT 3,
    "startedAt"   DATETIME,
    "completedAt" DATETIME,
    "duration"    INTEGER,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL,
    CONSTRAINT "AgentTask_claimId_fkey"
        FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ClaimLog" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "claimId"   TEXT NOT NULL,
    "taskId"    TEXT,
    "agentName" TEXT,
    "level"     TEXT NOT NULL DEFAULT 'INFO',
    "message"   TEXT NOT NULL,
    "details"   TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimLog_claimId_fkey"
        FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClaimLog_taskId_fkey"
        FOREIGN KEY ("taskId") REFERENCES "AgentTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ClaimEvent" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "claimId"   TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromAgent" TEXT,
    "toAgent"   TEXT,
    "payload"   TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimEvent_claimId_fkey"
        FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "SystemMetrics" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "agentName"      TEXT NOT NULL,
    "totalProcessed" INTEGER NOT NULL DEFAULT 0,
    "totalFailed"    INTEGER NOT NULL DEFAULT 0,
    "avgDuration"    REAL,
    "lastActiveAt"   DATETIME,
    "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "Claim_claimNumber_key"     ON "Claim"("claimNumber");
CREATE INDEX IF NOT EXISTS "Claim_status_idx"                 ON "Claim"("status");
CREATE INDEX IF NOT EXISTS "Claim_createdAt_idx"              ON "Claim"("createdAt");
CREATE INDEX IF NOT EXISTS "AgentTask_claimId_idx"            ON "AgentTask"("claimId");
CREATE INDEX IF NOT EXISTS "AgentTask_agentName_status_idx"   ON "AgentTask"("agentName", "status");
CREATE INDEX IF NOT EXISTS "ClaimLog_claimId_idx"             ON "ClaimLog"("claimId");
CREATE INDEX IF NOT EXISTS "ClaimLog_timestamp_idx"           ON "ClaimLog"("timestamp");
CREATE INDEX IF NOT EXISTS "ClaimLog_level_idx"               ON "ClaimLog"("level");
CREATE INDEX IF NOT EXISTS "ClaimEvent_claimId_idx"           ON "ClaimEvent"("claimId");
CREATE INDEX IF NOT EXISTS "ClaimEvent_eventType_idx"         ON "ClaimEvent"("eventType");
CREATE UNIQUE INDEX IF NOT EXISTS "SystemMetrics_agentName_key" ON "SystemMetrics"("agentName");
