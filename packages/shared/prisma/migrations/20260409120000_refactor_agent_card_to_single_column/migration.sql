-- Migration: replace cardDescription and skillsJson with single agentCard column
ALTER TABLE "AgentConfig" DROP COLUMN "cardDescription";
ALTER TABLE "AgentConfig" DROP COLUMN "skillsJson";
ALTER TABLE "AgentConfig" ADD COLUMN "agentCard" TEXT;
