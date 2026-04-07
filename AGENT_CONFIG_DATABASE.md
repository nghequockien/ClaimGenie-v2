# Agent Configuration Database Implementation

> **Date:** April 7, 2026  
> **Feature:** Persistent agent-specific LLM configuration storage in database

## Overview

Agent configurations are now **persisted to the database** instead of only being stored in memory or environment variables. This enables:

- ✅ Persistent configuration changes across application restarts
- ✅ Runtime configuration updates without environment variable changes
- ✅ Database-backed "single source of truth" for agent settings
- ✅ Real-time UI synchronization via SSE broadcasts
- ✅ Audit trail tracking (via `createdAt` and `updatedAt` timestamps)

## Database Schema

### `AgentConfig` Table

```prisma
model AgentConfig {
  id           String    @id @default(uuid())
  agentName    String    @unique
  provider     String    @default("anthropic")
  model        String    @default("claude-haiku-4-5")
  systemPrompt String
  temperature  Float     @default(0.7)
  maxTokens    Int       @default(4096)
  active       Boolean   @default(true)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}
```

**Fields:**
| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `id` | UUID | auto | Primary key |
| `agentName` | String | - | Agent identifier (UNIQUE) |
| `provider` | String | `anthropic` | LLM provider (anthropic, openai, azure-openai, gemini) |
| `model` | String | `claude-haiku-4-5` | Model identifier |
| `systemPrompt` | String | - | Agent behavior instructions |
| `temperature` | Float | 0.7 | Randomness (0-2) |
| `maxTokens` | Int | 4096 | Response length limit |
| `active` | Boolean | true | Configuration status |
| `createdAt` | DateTime | now | Creation timestamp |
| `updatedAt` | DateTime | now | Last modification timestamp |

## Default Configurations

Six agent configurations are seeded on database initialization:

| Agent                 | Provider  | Model             | Temperature | Max Tokens |
| --------------------- | --------- | ----------------- | ----------- | ---------- |
| CLAIMS_RECEIVER       | anthropic | claude-haiku-4-5  | 0.7         | 4096       |
| OCR_PROCESSOR         | anthropic | claude-opus-4-5   | 0.3         | 8192       |
| ICD_CONVERTER         | anthropic | claude-sonnet-4-5 | 0.2         | 2048       |
| CUSTOMER_VERIFICATION | anthropic | claude-haiku-4-5  | 0.3         | 2048       |
| FRAUD_DETECTION       | anthropic | claude-sonnet-4-5 | 0.4         | 4096       |
| PAYMENT_GENERATOR     | anthropic | claude-haiku-4-5  | 0.2         | 2048       |

## REST API Endpoints

### 1. Get Available LLM Providers

```http
GET /api/agents/config/providers
```

**Response:**

```json
[
  {
    "id": "anthropic",
    "name": "Anthropic Claude",
    "models": ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"]
  },
  {
    "id": "openai",
    "name": "OpenAI",
    "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"]
  },
  ...
]
```

### 2. Get All Agent Configurations

```http
GET /api/agents/config
```

**Response:**

```json
{
  "CLAIMS_RECEIVER": {
    "agentName": "CLAIMS_RECEIVER",
    "provider": "anthropic",
    "model": "claude-haiku-4-5",
    "systemPrompt": "You are an insurance claim...",
    "temperature": 0.7,
    "maxTokens": 4096,
    "configurable": true,
    "updatedAt": "2026-04-07T10:00:00.000Z"
  },
  ...
}
```

### 3. Get Single Agent Configuration

```http
GET /api/agents/config/:agentName
```

**Example:**

```http
GET /api/agents/config/CLAIMS_RECEIVER
```

**Response:**

```json
{
  "agentName": "CLAIMS_RECEIVER",
  "provider": "anthropic",
  "model": "claude-haiku-4-5",
  "systemPrompt": "You are an insurance claim...",
  "temperature": 0.7,
  "maxTokens": 4096,
  "configurable": true,
  "updatedAt": "2026-04-07T10:00:00.000Z"
}
```

### 4. Update Agent Configuration

```http
PUT /api/agents/config/:agentName
Content-Type: application/json

{
  "provider": "openai",
  "model": "gpt-4o",
  "systemPrompt": "Updated system prompt...",
  "temperature": 0.5,
  "maxTokens": 8000
}
```

**Response:**

```json
{
  "agentName": "CLAIMS_RECEIVER",
  "provider": "openai",
  "model": "gpt-4o",
  "systemPrompt": "Updated system prompt...",
  "temperature": 0.5,
  "maxTokens": 8000,
  "configurable": true,
  "updatedAt": "2026-04-07T10:30:00.000Z"
}
```

**Note:** Configuration updates are **broadcasted via SSE** as `agent-config-updated` events for real-time UI synchronization.

## UI Integration

### Configuration Page

- **Route:** `/config`
- **Component:** `packages/ui/src/pages/AgentConfigPage.tsx`
- **Features:**
  - Agent list sidebar with current provider/model
  - Provider dropdown (filters models)
  - Model selector
  - Temperature slider (0-2)
  - Max tokens input
  - System prompt textarea
  - Save button with success feedback

### Navigation

Added to sidebar with Settings icon and label "Configuration"

## Implementation Changes

### Files Modified/Created

```
packages/shared/
├── prisma/
│   ├── schema.prisma           (added AgentConfig model)
│   ├── migrations/
│   │   └── 20260407102530_add_agent_config/
│   │       └── migration.sql   (new migration)
│   └── seed.ts                 (updated with agent config seeding)
├── prisma.config.ts            (added seed configuration)
├── prisma.config.dev.ts        (added seed configuration)
└── prisma.config.prod.ts       (added seed configuration)

packages/gateway/
└── src/index.ts                (updated endpoints to use database)

packages/ui/
├── src/pages/AgentConfigPage.tsx        (added temperature/maxTokens fields)
├── src/api/index.ts                     (already had agentConfigApi)
├── src/types/index.ts                   (updated AgentConfig interface)
├── src/App.tsx                          (already had /config route)
└── src/components/layout/Layout.tsx     (already had config nav item)
```

## Database Operations

### Migration

```bash
cd packages/shared
npx prisma migrate deploy
```

### Generate Types

```bash
cd packages/shared
npx prisma generate
```

### Seed Database

```bash
cd packages/shared
npx tsx prisma/seed.ts
```

Or via Prisma's seed command:

```bash
cd packages/shared
npx prisma db seed
```

## How to Use

### 1. Initialize Database (One-time)

```bash
cd packages/shared
# Run migration
npx prisma migrate deploy

# Seed with defaults
npx prisma db seed
```

### 2. Start Application

```bash
# Gateway (port 4000)
pnpm --filter @claimgenie/gateway dev

# UI (port 5173)
pnpm --filter @claimgenie/ui dev
```

### 3. Configure Agents via UI

1. Navigate to **Configuration** in sidebar
2. Select an agent from the list
3. Choose provider and model
4. Adjust temperature and max tokens
5. Edit system prompt as needed
6. Click **Save Configuration**

### 4. Verify in Database

```bash
# Query agent config from SQLite
sqlite3 ./dev-data/dev.db "SELECT * FROM AgentConfig;"
```

## Technical Details

### Data Flow

```
UI → API (PUT /api/agents/config/:agentName)
  → Gateway (validates & persists)
  → Database (AgentConfig table)
  ↓
Gateway broadcasts SSE event
  ↓
UI receives update
  ↓
React Query invalidates cache
  ↓
UI reflects new configuration
```

### SSE Broadcasting

When an agent configuration is updated, the gateway broadcasts:

```json
{
  "event": "agent-config-updated",
  "data": {
    "agentName": "CLAIMS_RECEIVER",
    "provider": "openai",
    "model": "gpt-4o",
    ...
  }
}
```

### Type Safety

- Prisma generates types for `AgentConfig` model
- UI types defined in `packages/ui/src/types/index.ts`
- Gateway uses PrismaClient for database operations
- Full TypeScript compilation validation

## Future Enhancements

- [ ] Configuration versioning and rollback
- [ ] Agent-specific API key management
- [ ] Configuration profiles/templates
- [ ] Audit logging integration
- [ ] Configuration change history UI
- [ ] Bulk configuration export/import
- [ ] Configuration validation rules
- [ ] Cost estimation per configuration

## Troubleshooting

### Database Not Updated

1. Verify migration was applied:

   ```bash
   sqlite3 ./dev-data/dev.db ".tables"
   ```

2. Check AgentConfig table exists:

   ```bash
   sqlite3 ./dev-data/dev.db ".schema AgentConfig"
   ```

3. Verify seed was executed:
   ```bash
   sqlite3 ./dev-data/dev.db "SELECT COUNT(*) FROM AgentConfig;"
   ```

### Prisma Types Not Found

```bash
cd packages/shared
npx prisma generate
# Then rebuild gateway/shared
pnpm build
```

### Update Not Reflecting in UI

1. Check SSE connection is active (see MonitoringPage status)
2. Check browser console for errors
3. Verify gateway is running on port 4000
4. Check React Query devtools for cache status
