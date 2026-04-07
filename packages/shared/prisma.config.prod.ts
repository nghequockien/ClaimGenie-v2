// prisma.config.prod.ts — Production (PostgreSQL)
// Copied to prisma.config.ts by: node infrastructure/scripts/db-schema.js prod

import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: path.resolve(__dirname, "prisma", "schema.prisma"),
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    seed: path.resolve(__dirname, "prisma", "seed.ts"),
  },
});
