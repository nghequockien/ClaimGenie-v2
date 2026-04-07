-- PostgreSQL init script — runs once on first container start
-- Prisma migrations handle the actual schema

-- Ensure UUID extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE insurance_mas TO masuser;
