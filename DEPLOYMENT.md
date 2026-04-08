# Azure App Service Deployment Guide

**Created:** April 7, 2026  
**Project:** Insurance Claims Multi-Agent System (ClaimGenie)  
**Status:** PENDING USER APPROVAL

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Scope & Components](#scope--components)
4. [Infrastructure](#infrastructure)
5. [Container Strategy](#container-strategy)
6. [Infrastructure as Code](#infrastructure-as-code)
7. [Required Configuration](#required-configuration)
8. [Prerequisites](#prerequisites)
9. [Deployment Checklist](#deployment-checklist)
10. [Cost Estimate](#cost-estimate)
11. [Risk Management](#risk-management)
12. [FAQ & Troubleshooting](#faq--troubleshooting)

---

## Overview

This guide documents the deployment of the **Insurance Claims Multi-Agent System** to **Azure App Services** as a single containerized application with the following characteristics:

- **6 Independent Agents** (Claims Receiver, OCR Processor, ICD Converter, Customer Verification, Fraud Detection, Payment Generator)
- **API Gateway** for orchestration and routing
- **React Dashboard** for monitoring
- **PostgreSQL Database** (managed via Azure)
- **Single App Service Instance** with all components consolidated
- **Nginx Reverse Proxy** for internal service routing

### Why This Approach?

| Benefit                    | Details                                                       |
| -------------------------- | ------------------------------------------------------------- |
| **Cost Efficiency**        | Single App Service instance instead of 8+ separate services   |
| **Simplified Management**  | One container to manage, scale, and monitor                   |
| **Faster Deployment**      | Build once, deploy everywhere consistency                     |
| **Internal Communication** | Services communicate via localhost (fast, no network latency) |

---

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────┐
│        Azure App Service (Linux, Single Container)   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  Nginx Reverse Proxy (Port 8080)             │   │
│  │  ├─ GET  /                → UI (port 3000)   │   │
│  │  ├─ GET  /api/*           → Gateway (8000)   │   │
│  │  └─ POST /agent/*         → Agents (4001-05) │   │
│  └──────────────────────────────────────────────┘   │
│                      ↓                               │
│  ┌──────────────────────────────────────────────┐   │
│  │  Node.js Services (All Running Inside)       │   │
│  │  ├─ Gateway (port 8000)                      │   │
│  │  ├─ Claims Receiver Agent (port 4001)        │   │
│  │  ├─ OCR Processor Agent (port 4002)          │   │
│  │  ├─ ICD Converter Agent (port 4003)          │   │
│  │  ├─ Customer Verification (port 4004)        │   │
│  │  ├─ Fraud Detection (port 4005)              │   │
│  │  ├─ Payment Generator (port 4006)            │   │
│  │  └─ Shared (Prisma, Types, Utils)            │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
└─────────────────────────────────────────────────────┘
             ↓ (Network Connection)
┌─────────────────────────────────────────────────────┐
│   Azure Database for PostgreSQL (Flexible Server)    │
│   ├─ Engine: PostgreSQL 15                          │
│   ├─ Schema: Insurance Claims (auto-migrated)       │
│   └─ Backups: 7-day retention (default)            │
└─────────────────────────────────────────────────────┘
             ↓ (Image Storage)
┌─────────────────────────────────────────────────────┐
│    Azure Container Registry (ACR)                    │
│    └─ Image: mas:latest (built from Dockerfile)    │
└─────────────────────────────────────────────────────┘
```

### Service Communication Flow

```
User/Client
    ↓ (HTTPS)
Azure App Service Public Endpoint (app-name.azurewebsites.net:443)
    ↓
Nginx (Port 8080 → 8080)
    ├─ /api/* → Gateway (localhost:8000) [REST API]
    ├─ /agent/* → Agents (localhost:4001-4006) [Agent APIs]
    └─ / → UI (localhost:3000 or static files)
          ↓
    Internal Service-to-Service (A2A Protocol)
          ↓
    PostgreSQL (JDBC connection string)
```

---

## Scope & Components

### What Will Be Created

During Phase 2 (file generation), the following artifacts will be created:

#### 1. Docker & Container Files

- **`infrastructure/docker/Dockerfile.azure`** — Multi-stage Dockerfile for consolidated build
- **`infrastructure/docker/docker-entrypoint.sh`** — Startup script to launch all services
- **`infrastructure/docker/docker-compose.azure.yml`** — Local testing alternative

#### 2. Nginx Configuration

- **`infrastructure/nginx/nginx.conf`** — Updated routing rules
- **`infrastructure/nginx/app-service.conf`** — Azure-specific optimizations

#### 3. Infrastructure as Code (Bicep)

- **`infrastructure/bicep/main.bicep`** — Root template
- **`infrastructure/bicep/modules/app-service.bicep`** — App Service + plan
- **`infrastructure/bicep/modules/container-registry.bicep`** — ACR setup
- **`infrastructure/bicep/modules/postgres.bicep`** — PostgreSQL database
- **`infrastructure/bicep/modules/monitoring.bicep`** — Log Analytics + Application Insights
- **`infrastructure/bicep/parameters.bicepparam`** — Parameter file (customize for your environment)

#### 4. Azure Developer Configuration

- **`azure.yaml`** — Azure Developer CLI configuration
- **`.env.prod.example`** — Production environment variables template
- **`.github/workflows/deploy-azure.yml`** — GitHub Actions CI/CD pipeline (optional)

#### 5. Documentation

- **`DEPLOYMENT_STEPS.md`** — Step-by-step deployment instructions
- **`AZURE_SETUP.md`** — Azure prerequisite checklist
- **`TROUBLESHOOTING.md`** — Common issues and solutions

### Services Being Consolidated

| Service                         | Port                       | Function                                                  |
| ------------------------------- | -------------------------- | --------------------------------------------------------- |
| **Claims Receiver Agent**       | 4001                       | Extracts claim details from claim documents               |
| **OCR Processor Agent**         | 4002                       | Performs optical character recognition (OCR) on documents |
| **ICD Converter Agent**         | 4003                       | Converts medical billing codes (ICD-10)                   |
| **Customer Verification Agent** | 4004                       | Verifies customer identity and eligibility                |
| **Fraud Detection Agent**       | 4005                       | Analyzes claims for fraud risk                            |
| **Payment Generator Agent**     | 4006                       | Generates payment instructions and settlements            |
| **Gateway**                     | 8000                       | API orchestration, routing, and load balancing            |
| **UI Components**               | 3000 (dev) / static (prod) | React monitoring dashboard and admin panel                |
| **Nginx**                       | 8080                       | Reverse proxy and traffic routing                         |

---

## Infrastructure

### Azure Resources to Provision

#### 1. App Service (Compute)

```bicep
- SKU: Standard B2 (2 vCPU, 3.5 GB RAM)
- OS: Linux (Alpine-based)
- Pricing: ~$70/month
- Always-On: Enabled (prevent cold starts)
- Auto-Scale: Optional (scale to 2-3 instances for HA)
```

**Why B2?**

- Sufficient for all 6 agents + gateway + UI in single container
- Supports always-on to eliminate cold starts
- Cost-effective for dev/staging
- Upgrade to Premium (P1V2) for production HA

#### 2. Container Registry (ACR)

```bicep
- SKU: Standard
- Storage: 100 GB included
- Pricing: ~$5/month + storage costs
- Geo-replication: None (enable for disaster recovery)
```

#### 3. PostgreSQL Flexible Server

```bicep
- Version: PostgreSQL 15
- SKU: Burstable (Standard_B1ms) — 1 vCPU, 1 GB RAM
- Pricing: ~$40/month
- Backup: 7-day retention (default)
- Geo-redundancy: None (upgrade for HA)
```

**Database Details:**

- **Admin User:** `masadmin` (default, changeable)
- **Database Name:** `insurance_claims`
- **Connection String:** `postgresql://masadmin:PASSWORD@SERVER.postgres.database.azure.com:5432/insurance_claims`
- **Migrations:** Automatic via Prisma on app startup

#### 4. Log Analytics & Application Insights

```bicep
- Log Analytics Workspace: Pay-as-you-go
- App Insights: Connected to Log Analytics
- Pricing: ~$10-20/month (varies by data ingestion)
```

**Monitoring Capabilities:**

- Application performance metrics (APM)
- Container logs and stderr/stdout
- Custom traces from agents
- Alert rules for errors and performance degradation

#### 5. Virtual Network (Optional)

```bicep
- Enabled for production to isolate PostgreSQL
- Private Endpoint: Connect App Service to PostgreSQL privately
```

### Network Configuration

#### Public Endpoint (Current Plan)

```
App Service: https://insurance-mas-prod.azurewebsites.net
├─ HTTPS only (port 443)
├─ HTTP redirect enabled (port 80 → HTTPS)
└─ Custom domain supported
```

#### Networking Best Practices

- **Option A (Dev/Staging):** Public App Service + Private PostgreSQL endpoint
- **Option B (Production):** App Service in VNet + Private PostgreSQL endpoint + Application Gateway (WAF)

---

## Container Strategy

### Single Multi-Service Container Design

#### Why Consolidate?

1. **Cost:** One App Service instance instead of 8+
2. **Simplicity:** Single deployment unit, easier scaling
3. **Performance:** No network latency for inter-service calls
4. **Resource Efficiency:** Agents share memory and CPU

#### How It Works

**File Structure Inside Container:**

```
/app/
├── node_modules/          (dependencies)
├── packages/
│   ├── agents/            (6 agent packages)
│   ├── gateway/           (API gateway)
│   ├── ui/                (React app - pre-built)
│   └── shared/            (Prisma client, types)
├── dist/                  (compiled TypeScript)
└── etc/nginx/             (nginx config)
```

**Startup Flow (Entry Point: `docker-entrypoint.sh`):**

```bash
#!/bin/bash

# 1. Set up environment
export NODE_ENV=production
export DATABASE_URL=postgresql://...

# 2. Run migrations
cd /app/packages/shared
npx prisma migrate deploy
npx prisma db seed

# 3. Start agents in background using PM2 (process manager)
cd /app
pm2 start packages/agents/claims-receiver/dist/index.js --name claims-receiver
pm2 start packages/agents/ocr-processor/dist/index.js --name ocr-processor
pm2 start packages/agents/icd-converter/dist/index.js --name icd-converter
pm2 start packages/agents/customer-verification/dist/index.js --name customer-verification
pm2 start packages/agents/fraud-detection/dist/index.js --name fraud-detection
pm2 start packages/agents/payment-generator/dist/index.js --name payment-generator

# 4. Start gateway in background
pm2 start packages/gateway/dist/index.js --name gateway

# 5. Start Nginx (foreground, keeps container alive)
nginx -g "daemon off;"
```

**Process Manager Option:** PM2

- Manages background processes (agents, gateway)
- Auto-restart on failure
- Easy monitoring: `pm2 monit`, `pm2 logs`
- Alternative: Supervisor or systemd (if preferred)

#### Image Building (Multi-Stage)

**Stage 1: Build**

- Install dependencies (pnpm install)
- Generate Prisma client
- Compile TypeScript to JavaScript
- Bundle all packages

**Stage 2: Runtime**

- Copy compiled artifacts
- Install minimal production dependencies
- Add nginx, PM2, and startup script
- Final image: ~450 MB

---

## Infrastructure as Code

### Bicep Templates Overview

Bicep is Microsoft's native Infrastructure as Code language for Azure. It's simpler than ARM templates and Terraform.

#### Main Template Structure

```bicep
// infrastructure/bicep/main.bicep

param location string = 'eastus'
param appName string = 'insurance-mas-prod'
param environment string = 'prod'

module appService './modules/app-service.bicep' = {
  name: 'appServiceModule'
  params: {
    appName: appName
    location: location
    containerImage: '${acrName}.azurecr.io/mas:latest'
    postgresServer: postgresServer.outputs.hostname
    databaseUrl: postgresServer.outputs.connectionString
  }
}

module postgres './modules/postgres.bicep' = {
  name: 'postgresModule'
  params: {
    location: location
    serverName: '${appName}-db'
  }
}

module registry './modules/container-registry.bicep' = {
  name: 'registryModule'
  params: {
    registryName: '${replace(appName, '-', '')}'
    location: location
  }
}

module monitoring './modules/monitoring.bicep' = {
  name: 'monitoringModule'
  params: {
    location: location
    workspaceName: '${appName}-logs'
  }
}
```

#### Deployment Flow

```bash
# 1. Build Docker image locally
docker build -f infrastructure/docker/Dockerfile.azure \
  -t myregistry.azurecr.io/mas:latest .

# 2. Push to ACR
az acr build -r myregistry \
  -f infrastructure/docker/Dockerfile.azure \
  -t mas:latest .

# 3. Deploy infrastructure (Bicep)
az deployment group create \
  --resource-group my-resource-group \
  --template-file infrastructure/bicep/main.bicep \
  --parameters infrastructure/bicep/parameters.bicepparam

# 4. Configure App Service to use image
az webapp config container set \
  --resource-group my-resource-group \
  --name insurance-mas-prod \
  --docker-custom-image-name myregistry.azurecr.io/mas:latest \
  --docker-registry-server-url https://myregistry.azurecr.io \
  --docker-registry-server-username $ACR_USERNAME \
  --docker-registry-server-password $ACR_PASSWORD

# 5. Verify deployment
az webapp log tail \
  --resource-group my-resource-group \
  --name insurance-mas-prod
```

---

## Required Configuration

### 1. Azure Context (Required Before Deployment)

Provide the following information:

- **Subscription ID**: `00000000-0000-0000-0000-000000000000`
- **Resource Group Name**: `insurance-mas-prod-rg` (or existing)
- **Azure Region**: `eastus` (or your preferred region)
- **App Name**: `insurance-mas-prod`
- **Registry Name**: `insurancemas` (globally unique)
- **Environment**: `prod` or `staging`
- **Database Admin User**: `masadmin` (or custom)
- **Database Admin Password**: (securely generated, min 8 chars, special chars required)

### 2. Environment Variables (`.env.prod`)

Create `.env.prod` file in workspace root with production secrets:

```bash
# Database (will be overridden by App Service config)
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://masadmin:PASSWORD@server.postgres.database.azure.com:5432/insurance_claims

# LLM Providers (update with actual credentials)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_KEY=...

# External Services
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://...
AZURE_DOCUMENT_INTELLIGENCE_KEY=...

# Application Settings
NODE_ENV=production
LOG_LEVEL=info
PORT=8000
```

### 3. App Service Environment Variables

Configure in Azure Portal or via CLI:

```bash
az webapp config appsettings set \
  --resource-group my-resource-group \
  --name insurance-mas-prod \
  --settings \
    WEBSITES_ENABLE_APP_SERVICE_STORAGE=false \
    WEBSITES_PORT=8080 \
    DATABASE_URL="postgresql://..." \
    ANTHROPIC_API_KEY="..." \
    NODE_ENV=production
```

### 4. PostgreSQL Configuration

- **Firewall Rules**: Allow App Service IP (auto-configured via Bicep)
- **Connection Pooling**: Enabled (Prisma client pooling)
- **SSL Enforcement**: Required (default)
- **Max Connections**: 100 (sufficient for single app)

---

## Prerequisites

### Azure Prerequisites

- [ ] Valid Azure subscription (with owner or contributor access)
- [ ] Azure CLI (`az`) installed and authenticated
  ```bash
  az login
  az account set --subscription <subscription-id>
  ```
- [ ] Bicep CLI support enabled (built into Azure CLI 2.20+)

### Local Development Prerequisites

- [ ] Node.js 20.x or later
- [ ] pnpm 9.x or later
- [ ] Docker installed and running
- [ ] TypeScript knowledge (optional but helpful)

### Code Readiness Checklist

- [ ] All agents have `build` script in `package.json`
- [ ] All agents have `start` script in `package.json`
- [ ] Prisma schema finalized (`packages/shared/prisma/schema.prisma`)
- [ ] No pending database migrations
- [ ] `.env.prod` file prepared with credentials
- [ ] Docker builds successfully locally (`docker build -f infrastructure/docker/Dockerfile.azure .`)

### Assumptions

1. Agents communicate exclusively via A2A protocol (no shared file storage)
2. Database is single source of truth (no local SQLite in production)
3. Nginx is sufficient for routing (no complex service mesh needed)
4. Container image size < 1 GB (optimize if larger)
5. All services can run simultaneously on different ports without conflicts

---

## Deployment Checklist

### Phase 0: Pre-Deployment (Before File Generation)

- [ ] Gather Azure context information (subscription, region, app name, etc.)
- [ ] Verify local Docker build works
- [ ] Confirm all agents have proper `start` scripts
- [ ] Create `.env.prod` file with production credentials

### Phase 1: File Generation

- [ ] Create `infrastructure/docker/Dockerfile.azure`
- [ ] Create `infrastructure/docker/docker-entrypoint.sh`
- [ ] Create/update `infrastructure/nginx/nginx.conf`
- [ ] Create Bicep templates in `infrastructure/bicep/`
- [ ] Create `azure.yaml` for Azure Developer CLI
- [ ] Create GitHub Actions workflow (optional)
- [ ] Document secrets management strategy

### Phase 2: Local Testing

- [ ] Build Docker image: `docker build -f infrastructure/docker/Dockerfile.azure -t mas:latest .`
- [ ] Run locally: `docker run -p 8080:8080 -e DATABASE_URL=... mas:latest`
- [ ] Test endpoints:
  - `curl http://localhost:8080/` (UI)
  - `curl http://localhost:8080/api/health` (Gateway)
  - `curl http://localhost:8080/agent/claims-receiver/health` (Agent)
- [ ] Check logs: `docker logs <container-id>`
- [ ] Validate Bicep: `az bicep build -f infrastructure/bicep/main.bicep`

### Phase 3: Azure Validation

- [ ] Run `azure-validate` skill checks
- [ ] Verify subscription and permissions
- [ ] Check quotas for App Service, PostgreSQL, ACR
- [ ] Validate Bicep parameters
- [ ] Dry-run Bicep deployment (what-if analysis)

### Phase 4: Deployment

- [ ] Create resource group
- [ ] Build image: `az acr build -r <registry> -f infrastructure/docker/Dockerfile.azure -t mas:latest .`
- [ ] Deploy infrastructure: `az deployment group create ... --template-file infrastructure/bicep/main.bicep`
- [ ] Configure App Service environment variables
- [ ] Verify Prisma migrations ran
- [ ] Test endpoints in Azure
- [ ] Set up monitoring alerts

### Phase 5: Post-Deployment

- [ ] Verify web app URL is accessible
- [ ] Check Application Insights for errors
- [ ] Test all agent endpoints
- [ ] Verify database connectivity
- [ ] Enable HTTPS (should be auto)
- [ ] Set up custom domain (if needed)
- [ ] Configure auto-scale rules (optional)
- [ ] Document production access procedures

---

## Cost Estimate

### Monthly Breakdown (USD)

| Service                | SKU            | Quantity | Cost/Unit    | Total           |
| ---------------------- | -------------- | -------- | ------------ | --------------- |
| **App Service**        | Standard B2    | 1        | $70/month    | **$70.00**      |
| **PostgreSQL**         | Burstable B1ms | 1        | $40/month    | **$40.00**      |
| **Container Registry** | Standard       | 1        | $5/month     | **$5.00**       |
| **Log Analytics**      | Pay-as-go      | —        | $2.76 per GB | **$15.00**      |
| **Data Transfer**      | Outbound       | —        | $0.087/GB    | **$10.00**      |
| **TOTAL**              |                |          |              | **~$140/month** |

### Cost Optimization Tips

1. **Use B1 Shared tier for dev/test** (~$12/month instead of B2)
2. **Burstable PostgreSQL fine for staging** (~$40/month)
3. **Enable auto-scale** to handle peak loads without constant Premium tier
4. **Set up budgets and alerts** in Azure Cost Management
5. **Reserved instances** (1-year commitment saves ~20%)
6. **Spot VMs** for non-critical workloads

### Price Comparison: This Approach vs. Alternatives

| Approach                           | Cost/Month | Pros                                    | Cons                            |
| ---------------------------------- | ---------- | --------------------------------------- | ------------------------------- |
| **Single App Service (This Plan)** | ~$140      | Simplicity, lower cost, easy management | All eggs in one basket          |
| **8× Container Apps**              | ~$200-300  | Better isolation, per-service scaling   | Higher cost, complex networking |
| **8× App Services**                | ~$500+     | Independent scaling                     | Very expensive, overkill        |
| **Self-managed AKS**               | ~$250+     | Full control, multi-cloud ready         | Complex, requires expertise     |

---

## Risk Management

### Identified Risks & Mitigation

| Risk                                    | Severity | Impact                          | Mitigation                                                                                                               |
| --------------------------------------- | -------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Single container failure**            | HIGH     | All services unavailable        | 1. Enable App Service auto-restart<br>2. Scale to 2-3 instances (auto-scale)<br>3. Implement health checks               |
| **Initial cold start**                  | MEDIUM   | 30-60s startup delay            | 1. Keep App Service always-on<br>2. Use B2+ tier (not B1)<br>3. Pre-warm with background job                             |
| **Database connection pool exhaustion** | MEDIUM   | Agents can't query database     | 1. Configure Prisma pool size<br>2. Monitor connections in PostgreSQL<br>3. Upgrade to larger PostgreSQL SKU if exceeded |
| **Large image size**                    | LOW      | Slow deployment/startup         | 1. Multi-stage Docker build<br>2. Exclude dev dependencies<br>3. Use .dockerignore effectively                           |
| **Container port conflicts**            | LOW      | Services fail to start          | 1. Test locally first<br>2. Use unique ports (4001-4006)<br>3. Verify agent startup scripts                              |
| **PostgreSQL single region**            | HIGH     | Regional outage = total failure | 1. Enable geo-redundant backup<br>2. Implement DR procedure<br>3. Use Standard tier for HA                               |
| **Unencrypted secrets**                 | HIGH     | Credential compromise           | 1. Use Azure Key Vault<br>2. Managed identity for auth<br>3. Rotate secrets regularly                                    |

### Recommended High-Availability Setup (Production)

```
1. Scale to 2 instances (auto-scale 2-5 total)
2. Enable geo-redundancy for PostgreSQL
3. Use Standard PostgreSQL tier (not Burstable)
4. Application Gateway + WAF in front of App Service
5. Azure Front Door for multi-region failover
6. Azure Key Vault for secrets management
```

---

## FAQ & Troubleshooting

### Q: Can I deploy to different Azure regions?

**A:** Yes. Update the `location` parameter in `bicep/parameters.bicepparam`. Some services (like specific PostgreSQL versions) may not be available in all regions.

### Q: What if my Docker image is too large?

**A:**

- Use multi-stage builds (already in Dockerfile.azure)
- Remove devDependencies from final stage
- Use Alpine as base image (already done)
- Check `.dockerignore` to exclude unnecessary files

### Q: How do I scale to multiple instances?

**A:**

```bash
az appservice plan update --name <plan> --sku P1V2 --resource-group <rg>
az webapp update --resource-group <rg> --name <app> --number-of-workers 2
```

### Q: Can I use Terraform instead of Bicep?

**A:** Yes. Bicep and Terraform templates will both be generated. Terraform offers more flexibility and state management.

### Q: How do I monitor the agents?

**A:**

- Application Insights: `az monitor app-insights query ...`
- Logs: `az webapp log tail --resource-group <rg> --name <app>`
- PM2: `docker exec <app> pm2 monit`
- Custom metrics via agent logger

### Q: What if a database migration fails?

**A:**

- Connect to PostgreSQL: `psql postgresql://...`
- Check migrations: `SELECT * FROM _prisma_migrations;`
- Rollback: `npx prisma migrate resolve --name <migration>`
- Reapply: `npx prisma migrate deploy`

### Q: Can I use a different database (MySQL, CosmosDB)?

**A:** Yes, but schema changes required. Update `packages/shared/prisma/schema.prisma` and `DATABASE_PROVIDER` env var.

### Q: How do I implement custom domain?

**A:**

```bash
az app service domain create --resource-group <rg> --name example.com
az webapp config hostname add --resource-group <rg> --webapp-name <app> --hostname example.com
```

### Q: What's the deployment time?

**A:**

- Docker build: 5-10 min (first time), 1-2 min (cached)
- ACR push: 2-5 min
- Bicep deployment: 5-10 min
- App startup: 1-2 min
- **Total: 15-30 minutes**

### Q: How do I debug startup issues?

**A:**

```bash
# Stream logs in real-time
az webapp log tail --resource-group <rg> --name <app> --provider Application

# SSH into container (if enabled)
az webapp create-remote-connection --resource-group <rg> --name <app>

# Restart app
az webapp restart --resource-group <rg> --name <app>
```

### Q: Can I test locally before Azure deployment?

**A:** Yes!

```bash
docker build -f infrastructure/docker/Dockerfile.azure -t mas:latest .
docker run -p 8080:8080 \
  -e DATABASE_URL="postgresql://localhost/test" \
  -e NODE_ENV=development \
  mas:latest
```

---

## Appendix: File Structure After Deployment

```
insurance-claims-mas-v2/
├── .github/
│   └── workflows/
│       └── deploy-azure.yml          (Optional: CI/CD pipeline)
├── infrastructure/
│   ├── docker/
│   │   ├── Dockerfile.azure          ✨ NEW - Multi-service image
│   │   ├── docker-entrypoint.sh      ✨ NEW - Startup script
│   │   ├── docker-compose.dev.yml    (existing)
│   │   ├── docker-compose.prod.yml   (existing)
│   │   └── docker-compose.azure.yml  ✨ NEW - Local Azure testing
│   ├── nginx/
│   │   ├── nginx.conf                (updated with agent routes)
│   │   ├── app-service.conf          ✨ NEW - Azure-specific
│   │   └── ui.nginx.conf             (existing)
│   ├── bicep/                        ✨ NEW DIRECTORY
│   │   ├── main.bicep
│   │   ├── parameters.bicepparam
│   │   └── modules/
│   │       ├── app-service.bicep
│   │       ├── container-registry.bicep
│   │       ├── postgres.bicep
│   │       └── monitoring.bicep
│   └── scripts/
│       └── db-schema.js              (existing)
├── azure.yaml                        ✨ NEW - Azure CLI config
├── DEPLOYMENT.md                     ✨ NEW - This file
├── .env.prod.example                 ✨ NEW - Template
└── [existing workspace files]
```

---

## Next Steps

1. **Review this document** — Ensure alignment on architecture and approach
2. **Provide Azure context** — Fill in details from "Required Configuration" section
3. **Approve plan** — Sign off on strategy before file generation
4. **Phase 2 execution** — Generate all infrastructure files
5. **Local testing** — Build and test Docker image
6. **Azure deployment** — Execute via `azure-deploy` skill

---

**Document Version:** 1.0  
**Last Updated:** April 7, 2026  
**Status:** READY FOR REVIEW ✅
