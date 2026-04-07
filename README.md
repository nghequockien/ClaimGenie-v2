# ClaimGenie — Insurance Claims Multi-Agent System

A production-grade **multi-agent system** for automated insurance claims processing, built with:

- **Node.js + TypeScript** backend (6 independent agents)
- **React + TypeScript** monitoring dashboard (Vite + Tailwind)
- **A2A (Agent-to-Agent) protocol** for inter-agent communication
- **MCP (Model Context Protocol)** for external service integration
- **Multi-provider LLM support** per agent (Anthropic, OpenAI, Azure OpenAI, Gemini)
- **Prisma 7.6.x ORM** — SQLite (dev), PostgreSQL (prod)
- **pnpm workspaces** monorepo

---

## Architecture

```
                    ┌─────────────────────────────────────────────────┐
                    │                   PARALLEL GROUP                │
┌──────────────┐    │  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│    Claims    │─▶ |  │   OCR    │  │   ICD    │  │  Customer    │   │
│   Receiver   │    │  │Processor │  │Converter │  │Verification  │   │
│  (Entry pt)  │    │  │ :4002    │  │  :4003   │  │   :4004      │   │
└──────────────┘    │  └──────────┘  └──────────┘  └──────────────┘   │
      :4001         │       │  ┌──────────────┐         │             │
                    │       │  │   Fraud      │         │             │
                    │       │  │  Detection   │         │             │
                    │       │  │   :4005      │         │             │
                    │       │  └──────────────┘         │             │
                    └───────┼───────────────────────────┼─────────────┘
                            │    (all complete?)        │
                            ▼                           ▼
                    ┌──────────────────────────────────────┐
                    │         Payment Generator            │
                    │    (Handoff Agent)  :4006            │
                    │   Polls → computes → hands back      │
                    └──────────────────────────────────────┘
                                      │ A2A Handoff
                                      ▼
                              Claims Receiver
                           (finalizes COMPLETED)

                    ┌──────────────┐        ┌──────────┐
                    │  API Gateway │◀───────│    UI    │
                    │    :4000     │        │   :3000  │
                    └──────────────┘        └──────────┘
```

### Agent responsibilities

| Agent                 | Port | Model             | MCP?          | Role                                               |
| --------------------- | ---- | ----------------- | ------------- | -------------------------------------------------- |
| Claims Receiver       | 4001 | claude-haiku-4-5  | —             | Entry point, parallel dispatch, finalization       |
| OCR Processor         | 4002 | claude-opus-4-5   | —             | Vision OCR on documents / text extraction          |
| ICD Converter         | 4003 | claude-sonnet-4-5 | ✅ icd-mcp    | Diagnosis → ICD-10 codes                           |
| Customer Verification | 4004 | claude-haiku-4-5  | ✅ verify-mcp | Patient & insurance validation                     |
| Fraud Detection       | 4005 | claude-sonnet-4-5 | ✅ fraud-mcp  | Risk scoring & flag detection                      |
| Payment Generator     | 4006 | claude-haiku-4-5  | —             | Handoff agent — payment calculation & finalization |

---

## Quick Start (Development)

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`npm install -g pnpm@9`)
- At least one LLM API key (Anthropic, OpenAI, Azure OpenAI, or Gemini)

### 1. Clone & install

```bash
git clone https://github.com/your-org/insurance-mas
cd insurance-mas
pnpm install
```

### 2. Configure environment

```bash
cp .env.dev.example .env.dev
# Edit .env.dev - set provider + key (see LLM Configuration below)
```

### 3. Set up the database (SQLite)

```bash
pnpm setup:dev
# This runs: pnpm install + prisma generate + prisma migrate dev + prisma db seed
```

### 4. Start all services

```bash
# Terminal 1 — all agents in parallel
pnpm dev

# OR start individually:
cd packages/agents/claims-receiver && pnpm dev   # :4001
cd packages/agents/ocr-processor && pnpm dev     # :4002
cd packages/agents/icd-converter && pnpm dev     # :4003
cd packages/agents/customer-verification && pnpm dev  # :4004
cd packages/agents/fraud-detection && pnpm dev   # :4005
cd packages/agents/payment-generator && pnpm dev # :4006
cd packages/gateway && pnpm dev                  # :4000
cd packages/ui && pnpm dev                       # :3000
```

### 5. Open the UI

```
http://localhost:3000
```

Submit a sample claim via **New Claim → Load sample claim data** and watch it process in real-time on the Monitoring page.

---

## LLM Configuration

Each agent now supports selecting its own provider and model with two layers:

1. Agent-specific environment variables (highest priority)
2. JSON config file (`LLM_CONFIG_FILE` or `config/llm.config.json`)

Supported providers:

- `anthropic`
- `openai`
- `azure-openai`
- `gemini`

### Global environment variables

```bash
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5
LLM_TEMPERATURE=0.2
LLM_MAX_TOKENS=1200
LLM_TIMEOUT_MS=30000
```

### Per-agent environment override

Prefix any variable with the agent name, for example:

```bash
CLAIMS_RECEIVER_LLM_PROVIDER=openai
CLAIMS_RECEIVER_LLM_MODEL=gpt-4o-mini
CLAIMS_RECEIVER_OPENAI_API_KEY=your-key

OCR_PROCESSOR_LLM_PROVIDER=azure-openai
OCR_PROCESSOR_LLM_MODEL=gpt-4o
OCR_PROCESSOR_AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
OCR_PROCESSOR_AZURE_OPENAI_API_KEY=your-azure-key
OCR_PROCESSOR_AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

### Provider credential variables

```bash
# Anthropic
ANTHROPIC_API_KEY=...

# OpenAI
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1

# Azure OpenAI
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini

# Gemini
GEMINI_API_KEY=...
```

### JSON config file

- Copy `config/llm.config.example.json` to `config/llm.config.json`
- Optionally set `LLM_CONFIG_FILE` to point to a custom path

Any per-agent env variable overrides the JSON file.

---

## Development with Docker

```bash
# Copy env
cp .env.dev.example .env.dev
# Edit provider + key (see LLM Configuration below)

# Start everything in Docker (hot-reload)
pnpm docker:dev
# OR
docker-compose -f infrastructure/docker/docker-compose.dev.yml up --build
```

Services available:

- UI: http://localhost:3000
- API Gateway: http://localhost:4000
- Prisma Studio: `pnpm db:studio`

---

## Production Deployment

### 1. Configure production environment

```bash
cp .env.prod.example .env.prod
# Set: POSTGRES_PASSWORD, LLM provider/key settings, CORS_ORIGIN, etc.
```

### 2. Launch with Docker Compose

```bash
pnpm docker:prod
# OR
docker-compose -f infrastructure/docker/docker-compose.prod.yml up -d --build
```

This starts:

- PostgreSQL with persistent volume
- DB migration container (runs once)
- 6 agent containers
- API Gateway
- UI (nginx static)
- Nginx reverse proxy on port 80

### 3. Run migrations on an existing deployment

```bash
docker-compose -f infrastructure/docker/docker-compose.prod.yml run --rm db-migrate
```

### 4. View logs

```bash
# All services
docker-compose -f infrastructure/docker/docker-compose.prod.yml logs -f

# Single agent
docker logs mas-fraud-detection -f

# Last 100 lines
docker logs mas-payment-generator --tail 100
```

### 5. Scale an agent

```bash
docker-compose -f infrastructure/docker/docker-compose.prod.yml up -d --scale ocr-processor=3
```

---

## CI/CD (GitHub Actions)

The pipeline at `.github/workflows/ci-cd.yml`:

| Trigger           | Action                                                       |
| ----------------- | ------------------------------------------------------------ |
| Any push / PR     | Lint + TypeScript type-check                                 |
| Push to `develop` | Build all Docker images → push to GHCR → deploy staging      |
| Push to `main`    | Build → push → run DB migrations → rolling deploy production |

### Required GitHub Secrets

```
STAGING_HOST        # SSH host for staging server
STAGING_USER        # SSH username
STAGING_SSH_KEY     # SSH private key

PROD_HOST           # SSH host for production
PROD_USER           # SSH username
PROD_SSH_KEY        # SSH private key
```

Images are pushed to `ghcr.io/YOUR_ORG/insurance-mas-{service}`.

---

## Database

### Prisma commands

```bash
# Generate client after schema change
pnpm db:generate

# Create a new migration (dev)
pnpm db:migrate:dev

# Apply migrations (prod)
pnpm db:migrate:prod

# Open Prisma Studio
pnpm db:studio

# Reset dev database
pnpm db:reset

# Re-seed sample data
pnpm db:seed
```

### Switch between SQLite and PostgreSQL

In `.env.dev`:

```
DATABASE_PROVIDER=sqlite
DATABASE_URL=file:./dev.db
```

In `.env.prod`:

```
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

---

## MCP Service Integration

Three agents call external services via MCP:

| Agent                 | MCP endpoint env var   | Purpose                      |
| --------------------- | ---------------------- | ---------------------------- |
| ICD Converter         | `ICD_MCP_URL`          | ICD-10 code lookup           |
| Customer Verification | `VERIFICATION_MCP_URL` | Patient/insurance validation |
| Fraud Detection       | `FRAUD_MCP_URL`        | Risk scoring                 |

If an MCP service is unavailable, **each agent automatically falls back to its configured LLM provider** — the system never hard-fails due to missing MCP.

To wire up a real MCP server, set the env var and uncomment the `tools` parameter in the agent source.

---

## API Reference

### Submit a claim

```http
POST /api/claims
Content-Type: application/json

{
  "patientName": "Sarah Johnson",
  "patientDob": "1985-03-15",
  "patientId": "PAT-100234",
  "insuranceId": "INS-BLUE-789012",
  "providerId": "PROV-HOSP-001",
  "providerName": "Metro General Hospital",
  "dateOfService": "2024-11-10",
  "diagnosis": "Acute appendicitis with abscess",
  "treatmentDetails": "Emergency appendectomy, 3-day hospital stay",
  "totalAmount": 18500,
  "currency": "USD",
  "priority": "HIGH"
}
```

### Get claim with full details

```http
GET /api/claims/:id
```

### Retry a failed claim

```http
POST /api/claims/:id/retry
```

### Stream real-time logs for a claim

```http
GET /api/claims/:id/stream
# Returns text/event-stream (SSE)
```

### Global real-time event stream

```http
GET /api/events
# Returns text/event-stream — all agent log events
```

### System metrics

```http
GET /api/metrics
```

### Agent health check

```http
GET /api/health/agents
```

---

## Project Structure

```
insurance-claims-mas/
├── packages/
│   ├── shared/                    # Shared types, Prisma, base agent, A2A protocol
│   │   ├── src/
│   │   │   ├── types.ts           # All TypeScript types + constants
│   │   │   ├── a2a.ts             # A2A protocol client + SSE emitter
│   │   │   ├── base-agent.ts      # BaseAgent class (Express + Prisma + A2A)
│   │   │   └── logger.ts          # Structured logger
│   │   └── prisma/
│   │       ├── schema.prisma      # DB schema (SQLite/PostgreSQL)
│   │       └── seed.ts            # Sample claim data
│   │
│   ├── agents/
│   │   ├── claims-receiver/       # Entry point + orchestrator + SSE
│   │   ├── ocr-processor/         # Vision OCR via Claude
│   │   ├── icd-converter/         # ICD-10 conversion via MCP/Claude
│   │   ├── customer-verification/ # Patient verification via MCP/Claude
│   │   ├── fraud-detection/       # Fraud scoring via MCP/Claude
│   │   └── payment-generator/     # Handoff agent — payment calculation
│   │
│   ├── gateway/                   # API Gateway (proxy + SSE broadcast)
│   └── ui/                        # React dashboard
│       └── src/
│           ├── pages/             # Dashboard, Claims, ClaimDetail, Monitoring, NewClaim
│           ├── components/        # AgentPipeline, LogViewer, Layout
│           ├── hooks/             # useSSE (global + per-claim streaming)
│           ├── store/             # Zustand global state
│           ├── api/               # Axios API client
│           └── types/             # UI type definitions
│
├── infrastructure/
│   ├── docker/
│   │   ├── docker-compose.dev.yml    # Dev: SQLite + hot reload
│   │   ├── docker-compose.prod.yml   # Prod: PostgreSQL + nginx
│   │   ├── Dockerfile.agent          # Dev agent image
│   │   ├── Dockerfile.agent.prod     # Multi-stage prod agent
│   │   ├── Dockerfile.gateway.prod   # Gateway prod image
│   │   ├── Dockerfile.ui.dev         # Vite dev server
│   │   └── Dockerfile.ui.prod        # Static build + nginx
│   └── nginx/
│       ├── nginx.conf                # Reverse proxy (SSE-aware)
│       └── ui.nginx.conf             # SPA static file server
│
└── .github/workflows/
    └── ci-cd.yml                  # Lint → build → staging → production
```

---

## Monitoring Dashboard

The **Monitoring** page (`/monitoring`) shows:

- **Agent health grid** — live ping status for all 6 agents
- **Real-time log feed** — SSE-powered, color-coded by level and agent
- **Filters** — by log level, agent name, or text search
- **Error/Warning counters** — live tallies

The **Claim Detail** page (`/claims/:id`) shows:

- **Agent pipeline visualization** — per-task status with live updates
- **Re-run button** — visible whenever a claim is failed or stuck; resets failed tasks and re-dispatches
- **Live log tab** — SSE stream for that specific claim
- **Tasks tab** — per-agent timing, retry counts, error messages
- **Results tab** — ICD codes, OCR text, fraud score, payment breakdown

---

## Retry / Re-run Behavior

When a claim fails at any step:

1. The **Re-run Processing** button appears on the claim detail page
2. Clicking it calls `POST /api/claims/:id/retry`
3. The Claims Receiver resets all `FAILED` tasks back to `PENDING`
4. The claim status is reset to `RECEIVED`
5. All parallel agents are re-dispatched via A2A
6. Progress resumes from scratch (idempotent)

Individual agent tasks also support per-task retry via `POST /api/agents/:name/retry/:taskId`.
