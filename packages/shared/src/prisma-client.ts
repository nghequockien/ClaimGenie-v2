// Prisma 7 client factory  Edriver adapters replace url-in-schema
// Dev:  @prisma/adapter-libsql  (SQLite via libsql)
// Prod: @prisma/adapter-pg      (PostgreSQL)

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { PrismaClient } from "@prisma/client";

let prismaReady: Promise<void> = Promise.resolve();

function getEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;

  const unwrapped =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
      ? value.slice(1, -1).trim()
      : value;
  if (!unwrapped) return undefined;

  const normalized = unwrapped.toLowerCase();
  if (normalized === "undefined" || normalized === "null") {
    return undefined;
  }

  return unwrapped;
}

function findSharedPackageRoot(startDir: string): string {
  let currentDir = startDir;

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");

    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
          name?: string;
        };
        if (pkg.name === "@claimgenie/shared") {
          return currentDir;
        }
      } catch {
        // Keep walking up if this package.json cannot be parsed.
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  // Fallback for source execution where __dirname is usually packages/shared/src
  return path.resolve(startDir, "..");
}

function toSqliteFileUrl(
  rawUrl: string | undefined,
  sharedRoot: string,
): string {
  const trimmed = rawUrl?.trim();

  if (!trimmed) {
    const defaultPath = path.resolve(sharedRoot, "dev-data", "dev.db");
    fs.mkdirSync(path.dirname(defaultPath), { recursive: true });
    return pathToFileURL(defaultPath).toString();
  }

  if (trimmed === "file::memory:" || trimmed === ":memory:") {
    return "file::memory:";
  }

  const rawPath = trimmed.startsWith("file:") ? trimmed.slice(5) : trimmed;
  const resolvedPath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(sharedRoot, rawPath);

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  return pathToFileURL(resolvedPath).toString();
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function cleanupStaleSqliteJournal(sqliteUrl: string) {
  if (sqliteUrl === "file::memory:") return;

  const dbFilePath = fileURLToPath(sqliteUrl);
  const journalPath = `${dbFilePath}-journal`;
  const dbExists = fs.existsSync(dbFilePath);
  const dbSize = dbExists ? fs.statSync(dbFilePath).size : 0;

  if (dbSize === 0 && fs.existsSync(journalPath)) {
    fs.rmSync(journalPath, { force: true });
  }
}

async function hasSqliteSchema(client: PrismaClient) {
  const rows = await client.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Claim' LIMIT 1;",
  );
  return rows.length > 0;
}

async function initializeSqliteConnection(client: PrismaClient) {
  await client.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
  await client.$executeRawUnsafe("PRAGMA synchronous = NORMAL;");
  await client.$executeRawUnsafe("PRAGMA foreign_keys = ON;");
  await client.$executeRawUnsafe("PRAGMA busy_timeout = 10000;");
}

async function bootstrapSqliteSchema(
  client: PrismaClient,
  sharedRoot: string,
  sqliteUrl: string,
) {
  if (sqliteUrl === "file::memory:") {
    return;
  }

  const dbFilePath = fileURLToPath(sqliteUrl);
  const dbExists = fs.existsSync(dbFilePath);
  const dbSize = dbExists ? fs.statSync(dbFilePath).size : 0;
  let needsBootstrap = !dbExists || dbSize === 0;

  if (!needsBootstrap) {
    try {
      needsBootstrap = !(await hasSqliteSchema(client));
    } catch {
      needsBootstrap = true;
    }
  }

  if (!needsBootstrap) {
    return;
  }

  cleanupStaleSqliteJournal(sqliteUrl);

  const migrationsRoot = path.resolve(sharedRoot, "prisma", "migrations");
  const migrationFiles = fs.existsSync(migrationsRoot)
    ? fs
        .readdirSync(migrationsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(migrationsRoot, entry.name, "migration.sql"))
        .filter((filePath) => fs.existsSync(filePath))
        .sort((left, right) => left.localeCompare(right))
    : [];

  for (const migrationFile of migrationFiles) {
    const sql = fs.readFileSync(migrationFile, "utf8");
    for (const statement of splitSqlStatements(sql)) {
      await client.$executeRawUnsafe(statement);
    }
  }

  if (!(await hasSqliteSchema(client))) {
    throw new Error(
      "SQLite schema bootstrap failed: Claim table was not created",
    );
  }
}

function createPrismaClient(): PrismaClient {
  const provider = getEnvValue("DATABASE_PROVIDER") ?? "sqlite";
  const databaseUrl = getEnvValue("DATABASE_URL");
  const canUsePostgres = provider === "postgresql" && Boolean(databaseUrl);
  const debugDbInit = process.env.DEBUG_DB_INIT === "1";

  if (debugDbInit) {
    console.info(
      `[shared/prisma-client] provider=${provider} rawUrl=${databaseUrl ?? "<empty>"}`,
    );
  }

  if (canUsePostgres) {
    const { Pool } = require("pg") as typeof import("pg");
    const { PrismaPg } =
      require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
    const pool = new Pool({ connectionString: databaseUrl });
    const adapter = new PrismaPg(pool);
    prismaReady = Promise.resolve();
    return new PrismaClient({ adapter } as any);
  }

  if (provider === "postgresql" && !databaseUrl) {
    console.warn(
      "[shared/prisma-client] DATABASE_PROVIDER=postgresql but DATABASE_URL is missing/invalid. Falling back to sqlite.",
    );
  }

  // Default: SQLite via libsql adapter.
  const { PrismaLibSql } = require("@prisma/adapter-libsql") as {
    PrismaLibSql: any;
  };

  // Normalize relative SQLite paths against the shared package root.
  const sharedRoot = findSharedPackageRoot(__dirname);
  const url = toSqliteFileUrl(databaseUrl, sharedRoot);
  cleanupStaleSqliteJournal(url);
  if (debugDbInit) {
    console.info(`[shared/prisma-client] sqlite url=${url}`);
  }
  const adapter = new PrismaLibSql({ url });
  const client = new PrismaClient({ adapter } as any);
  prismaReady = (async () => {
    await initializeSqliteConnection(client);
    await bootstrapSqliteSchema(client, sharedRoot, url);
  })();
  return client;
}

export const prismaClient = createPrismaClient();
export { prismaReady };
