#!/usr/bin/env node
// Cross-platform Prisma schema + config switcher (Windows, macOS, Linux)
// Usage:
//   node infrastructure/scripts/db-schema.js dev
//   node infrastructure/scripts/db-schema.js prod

const fs   = require('fs');
const path = require('path');

const mode = process.argv[2];
if (!mode || !['dev', 'prod'].includes(mode)) {
  console.error('Usage: node infrastructure/scripts/db-schema.js [dev|prod]');
  process.exit(1);
}

const sharedDir = path.join(__dirname, '../../packages/shared');
const prismaDir = path.join(sharedDir, 'prisma');

// 1. Copy the right schema.prisma
const schemaSrc  = path.join(prismaDir, `schema.${mode}.prisma`);
const schemaDest = path.join(prismaDir, 'schema.prisma');
if (!fs.existsSync(schemaSrc)) {
  console.error(`Source schema not found: ${schemaSrc}`);
  process.exit(1);
}
fs.copyFileSync(schemaSrc, schemaDest);

// 2. Copy the right prisma.config.ts
const configSrc  = path.join(sharedDir, `prisma.config.${mode}.ts`);
const configDest = path.join(sharedDir, 'prisma.config.ts');
if (!fs.existsSync(configSrc)) {
  console.error(`Source config not found: ${configSrc}`);
  process.exit(1);
}
fs.copyFileSync(configSrc, configDest);

const provider = mode === 'dev' ? 'SQLite (development)' : 'PostgreSQL (production)';
console.log(`✅ Active Prisma schema + config → ${provider}`);
