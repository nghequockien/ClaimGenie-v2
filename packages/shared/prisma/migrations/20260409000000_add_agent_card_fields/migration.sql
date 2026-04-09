-- AlterTable: add Agent Card overrideable fields to AgentConfig
ALTER TABLE "AgentConfig" ADD COLUMN "cardDescription" TEXT;
ALTER TABLE "AgentConfig" ADD COLUMN "skillsJson"      TEXT;
