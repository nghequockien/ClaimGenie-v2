// prisma.config.dev.ts — Development (SQLite)
// Copied to prisma.config.ts by: node infrastructure/scripts/db-schema.js dev

import path from "node:path";
import { defineConfig } from "prisma/config";

const dbPath = path.resolve(__dirname, "dev-data", "dev.db");

export default defineConfig({
  schema: path.resolve(__dirname, "prisma", "schema.prisma"),
  datasource: {
    url: `file:${dbPath}`,
  },
  migrations: {
    seed: path.resolve(__dirname, "prisma", "seed.ts"),
  },
});
