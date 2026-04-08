# Azure App Service Deployment Plan

**Created:** April 7, 2026  
**Mode:** MODIFY (Add Azure deployment to existing monorepo)  
**Status:** PENDING USER APPROVAL

---

## 1. DECISION SUMMARY

### Project Classification

- **Type:** Multi-agent system (6 agents + gateway + UI)
- **Tech Stack:** Node.js 20 + TypeScript + React + PostgreSQL
- **Scale:** Production-grade with monitoring dashboard
- **Deployment:** Containerized to Azure App Service

### Deployment Strategy

| Component                                | Strategy                                               | Azure Service                                       |
| ---------------------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| **All Services** (Gateway, 6 Agents, UI) | Single consolidated container with nginx reverse proxy | **App Service** (Linux, container)                  |
| **Database**                             | Managed PostgreSQL                                     | **Azure Database for PostgreSQL** (Flexible Server) |
| **Container Registry**                   | Store built images                                     | **Azure Container Registry (ACR)**                  |
| **Networking**                           | Default public endpoints                               | **Virtual Network** (optional, for production)      |
| **Monitoring**                           | Application logs + container insights                  | **Log Analytics** + **App Insights**                |

### Architecture Design

```
Azure App Service (Linux, Single Container)
├── Nginx reverse proxy (port 8080)
│   ├── /api/* → Gateway (localhost:8000)
│   ├── /agent/* → Agents (localhost:4001-4005)
│   └── / → UI (localhost:3000)
├── Gateway (Node.js, port 8000)
├── Agents (6 × Node.js processes, ports 4001-4005)
├── UI dev server (Vite, port 3000) [prod: built static files]
└── Shared (Prisma client, types, utils)

↓ (network)

Azure Database for PostgreSQL
└── Insurance claims schema + seed data
```

---

## 2. SCOPE & COMPONENTS

### What Will Be Created

1. **Docker consolidation** — New `Dockerfile.azure` that starts ALL services in one container
2. **Nginx configuration** — Route traffic to internal services
3. **Azure infrastructure** — Bicep templates for:
   - App Service (Linux, container, always-on)
   - Container Registry (for image storage)
   - Azure Database for PostgreSQL (Flexible Server)
   - Log Analytics + Application Insights
   - App Service plan (B2 minimum)
4. **Configuration files**:
   - `azure.yaml` — Azure Developer CLI config
   - `.env.prod` template for production secrets
   - Docker Compose alternative for local testing
5. **Build scripts** — GitHub Actions workflow for CI/CD (optional)

### Services Consolidated

| Service                         | Port                       | Role                                 |
| ------------------------------- | -------------------------- | ------------------------------------ |
| **Claims Receiver Agent**       | 4001                       | Extract claim details from documents |
| **OCR Processor Agent**         | 4002                       | Document optical recognition         |
| **ICD Converter Agent**         | 4003                       | Medical code conversion              |
| **Customer Verification Agent** | 4004                       | Identity verification                |
| **Fraud Detection Agent**       | 4005                       | Fraud assessment                     |
| **Payment Generator Agent**     | 4006                       | Generate payment instructions        |
| **Gateway**                     | 8000                       | API orchestration + routing          |
| **UI**                          | 3000 (dev) / static (prod) | React monitoring dashboard           |

---

## 3. INFRASTRUCTURE DECISIONS

### Azure Resources

- **App Service Plan**: Linux, Standard B2 (2 vCPU, 3.5 GB RAM)
  - Rationale: All services in single container
  - Cost: ~$70 USD/month
- **Container Registry**: Standard tier (0.167 USD/day + storage)
- **PostgreSQL Server**: Burstable - Standard_B1ms (1 vCPU, 1 GB)
  - Rationale: Dev/staging scale; upgrade to Standard_D2s for production
  - Cost: ~$40 USD/month
- **Log Analytics**: Pay-as-you-go (data ingestion charges)

### Database Configuration

- **Engine:** PostgreSQL 15 (latest stable)
- **Geo-redundancy:** None (enable for production HA)
- **Backup:** 7-day retention (default)
- **Schema:** Automatic via Prisma migrations on container startup
- **Environment variable:** `DATABASE_URL=postgresql://<user>:<pwd>@<server>:5432/<db>`

### Networking

- **App Service:** Public endpoint (HTTP + HTTPS)
- **PostgreSQL:** Private endpoint recommended (for production)
- **Secrets:** Stored in App Service environment variables / Key Vault integration

---

## 4. CONTAINER STRATEGY

### Single Multi-Service Container Design

**Why?** App Service charges per instance; consolidating reduces cost and simplifies management.

**How?**

1. Start all 6 agents as background Node.js processes
2. Start Gateway on port 8000
3. Optionally start UI dev server (or serve pre-built static)
4. Nginx on port 8080 routes traffic to services
5. Shared Prisma client initialized by startup script

**Entry Point:** Custom start script that:

```bash
# Run migrations
cd packages/shared && npx prisma migrate deploy

# Start all agents in background (or via PM2/node-foreman)
cd packages/agents/claims-receiver && node dist/index.js &
cd packages/agents/ocr-processor && node dist/index.js &
# ... (repeat for all agents and gateway)

# Start Nginx (foreground, PID 1)
nginx -g "daemon off;"
```

### Image Building

- **Build stage:** Compile TypeScript, install dependencies, bundle all services
- **Runtime stage:** Ship pre-built artifacts + nginx binary
- **Base image:** `node:20-alpine` (lightweight)
- **Final image size:** ~450 MB (estimate)

---

## 5. INFRASTRUCTURE AS CODE

### Recipe Selection: **Bicep** (Recommended)

- **Why:** Native Azure, simpler syntax, no state management like Terraform
- **Alternative:** Terraform (if IaC skills prefer; both supported)

### Bicep Structure

```
infrastructure/
├── bicep/
│   ├── main.bicep                    (main template)
│   ├── modules/
│   │   ├── app-service.bicep         (App Service + plan)
│   │   ├── container-registry.bicep  (ACR)
│   │   ├── postgres.bicep            (Azure Database for PostgreSQL)
│   │   └── monitoring.bicep          (Log Analytics + App Insights)
│   └── parameters.bicepparam         (parameter values)
└── docker/
    ├── Dockerfile.azure              (consolidated multi-service)
    ├── docker-entrypoint.sh          (startup script)
    └── nginx.conf                    (routing configuration)
```

### Deployment Flow

1. **Local build**: `docker build -f infrastructure/docker/Dockerfile.azure -t <acr-name>.azurecr.io/mas:latest .`
2. **Registry push**: `az acr build -r <acr-name> -f infrastructure/docker/Dockerfile.azure -t mas:latest .`
3. **Infrastructure**: `az deployment group create -f infrastructure/bicep/main.bicep -g <resource-group>`
4. **App Service config**: Set container image URI in App Service settings
5. **Verify**: `az container logs --resource-group <rg> --name <app-service-name>`

---

## 6. AZURE CONTEXT REQUIRED

> **❓ USER CONFIRMATION NEEDED:**
> Before proceeding to Phase 2 (file generation), confirm:

- [ ] **Azure Subscription ID**: Which subscription to deploy to?
- [ ] **Resource Group Name**: Create new or use existing? Name?
- [ ] **Azure Region**: (e.g., `eastus`, `westeurope`, `eastasia`)
- [ ] **App Name**: (e.g., `insurance-mas-prod`)
- [ ] **Image Registry Name**: (e.g., `insurancemas`)
- [ ] **Environment**: Staging, Prod, or Dev?
- [ ] **Database Admin Username**: (default: `masadmin`)
- [ ] **Preferred IaC**: Bicep (default) or Terraform?

---

## 7. PREREQUISITES & ASSUMPTIONS

### Azure Prerequisites

- [ ] Valid Azure subscription with owner/contributor access
- [ ] Azure CLI (`az`) installed and authenticated
- [ ] Docker installed locally (for image building)
- [ ] pnpm 9.x and Node.js 20.x available

### Code Prerequisites

- [ ] Existing monorepo structure (already present ✓)
- [ ] All agents have `build` and `start` scripts in package.json
- [ ] `.env.prod` file populated with LLM credentials (Claude, OpenAI, etc.)
- [ ] Prisma schema finalized (no pending migrations)

### Assumptions

- Agents can run as background processes in single container
- No inter-agent file I/O beyond database (all via A2A protocol)
- Nginx sufficient for routing; no complex orchestration
- PostgreSQL as the production database

---

## 8. DEPLOYMENT CHECKLIST

### Phase 2: File Generation (After Approval)

- [ ] Create `infrastructure/docker/Dockerfile.azure` (multi-service consolidated)
- [ ] Create `infrastructure/docker/docker-entrypoint.sh` (startup logic)
- [ ] Update `infrastructure/nginx/nginx.conf` (add agent routes)
- [ ] Create Bicep templates (app service, registry, database, monitoring)
- [ ] Create `azure.yaml` (Azure Developer CLI config)
- [ ] Create GitHub Actions workflow (optional: auto-deploy on push)
- [ ] Create `.env.prod.example` template

### Phase 3: Validation (Before Deploy)

- [ ] Test `docker build` locally
- [ ] Test `docker run` locally (hit all endpoints)
- [ ] Validate Bicep syntax and parameters
- [ ] Run preflight checks via `azure-validate` skill

### Phase 4: Deployment (via `azure-deploy` skill)

- [ ] Create resource group (via Bicep)
- [ ] Build and push image to ACR
- [ ] Deploy infrastructure
- [ ] Configure environment variables in App Service
- [ ] Run Prisma migrations
- [ ] Health check endpoints
- [ ] Enable monitoring and alerts

---

## 9. COST ESTIMATE (Monthly, USD)

| Service            | SKU            | Cost/Month          |
| ------------------ | -------------- | ------------------- |
| App Service        | Standard B2    | ~$70                |
| PostgreSQL         | Burstable B1ms | ~$40                |
| Container Registry | Standard       | ~$5                 |
| Log Analytics      | Pay-as-you-go  | ~$10-20             |
| **TOTAL**          |                | **~$125-135/month** |

> **Note:** Upgrade SKUs for production HA (e.g., Premium for App Service, Standard for PostgreSQL).

---

## 10. RISKS & MITIGATION

| Risk                                  | Impact                     | Mitigation                                                       |
| ------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| Single container failure              | All services down          | Implement App Service auto-restart + scale to multiple instances |
| Port conflicts in container           | Services fail to start     | Test locally; use process manager (PM2)                          |
| Database connection from all services | Connection pool saturation | Configure Prisma pool size; upgrade PostgreSQL compute           |
| Cold starts                           | Slow initial response      | Keep App Service always-on; use B2+ SKU                          |
| Image size                            | Slow deployment            | Multi-stage Dockerfile; optimize node_modules caching            |

---

## 11. APPROVAL & NEXT STEPS

### ✅ Ready for Execution?

If plan approved, proceed with:

1. **File Generation Phase** (2 hrs est.)
   - Dockerfiles, Bicep, configs
2. **Local Testing** (30 min)
   - `docker build && docker run` locally
   - Test all endpoints

3. **Validation** (30 min)
   - Run `azure-validate` checks

4. **Deployment** (20 min)
   - Execute via `azure-deploy` skill
   - Monitor logs

**Total time to production: 3-4 hours**

---

## Status

- ⏳ **PENDING:** User approval on Azure context (Step 6)
- ⏳ **PENDING:** Confirmation on Bicep vs Terraform recipe
- ⏭️ **NEXT:** Phase 2 file generation (after approval)
