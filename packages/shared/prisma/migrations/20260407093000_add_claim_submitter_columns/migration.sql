-- Add dedicated submitter columns to Claim for queryable auditability
ALTER TABLE "Claim" ADD COLUMN "submittedByUserId" TEXT;
ALTER TABLE "Claim" ADD COLUMN "submittedByEmail" TEXT;
ALTER TABLE "Claim" ADD COLUMN "submittedByName" TEXT;
ALTER TABLE "Claim" ADD COLUMN "submittedByRole" TEXT;
ALTER TABLE "Claim" ADD COLUMN "submittedByProvider" TEXT;

CREATE INDEX IF NOT EXISTS "Claim_submittedByEmail_idx" ON "Claim"("submittedByEmail");
CREATE INDEX IF NOT EXISTS "Claim_submittedByUserId_idx" ON "Claim"("submittedByUserId");
