# Security Model

This document summarizes the implemented security architecture for agent-to-agent (A2A) communication in this project.

## Goals

1. Keep each agent independent.
2. Discover agents dynamically via Agent Card registry.
3. Authenticate service-to-service calls with OAuth 2.0 Client Credentials.
4. Authorize calls by issuer, audience, scope, and client-to-agent identity binding.
5. Reject spoofed fromAgent values in A2A payloads.

## Security Architecture

### Components

1. Agent Card endpoint on each agent:

- GET /agent-card
- GET /.well-known/agent-card.json

2. Registry endpoints in gateway:

- GET /api/registry/agents
- GET /api/registry/agents/:agentName

3. Outbound A2A client security:

- Discovery-first target resolution
- OAuth 2.0 token acquisition (Client Credentials)
- Access token caching and refresh safety window
- Bearer token on every A2A request

4. Inbound A2A endpoint security:

- JWT verification against JWKS
- Issuer check
- Audience check
- Required scope check
- fromAgent to token identity binding check

## Implemented Flow: A2A Discovery -> Authentication -> Task Send

### Step 1: Discovery

1. Caller agent resolves the target agent via registry.
2. Registry returns target Agent Card with:

- url (agent host URL)
- authentication.schemes (for example, Bearer)
- authentication.credentials (optional private hints, may contain JSON such as tokenEndpoint, audience, scope)
- skills/capabilities metadata

If registry is unavailable, caller uses static fallback host/port routing.

### Step 2: OAuth 2.0 Client Credentials

1. Caller requests token from IdP token endpoint using grant_type=client_credentials.
2. Caller can send credentials by:

- client_secret_post (default)
- client_secret_basic

3. Caller requests target scope and audience.
4. Caller caches token until shortly before expiry.

### Step 3: Task Send

1. Caller sends POST to target /a2a/receive.
2. Caller includes headers:

- Authorization: Bearer <access_token>
- X-A2A-Protocol: A2A/1.0
- X-A2A-From: <agent>
- X-A2A-Discovery: registry or static

3. Caller sends A2A payload with fromAgent, toAgent, messageType, correlationId, payload.

### Step 4: Receiver Validation and Authorization

Receiver middleware validates in this order:

1. Bearer token exists.
2. JWT signature is valid using JWKS.
3. Token issuer matches configured issuer.
4. Token audience matches configured audience.
5. Token contains required scope.
6. fromAgent in payload matches authenticated client identity mapping.

If any check fails, request is rejected before business logic execution.

## fromAgent Anti-Spoofing (Implemented)

The system enforces that payload fromAgent cannot be forged.

Identity source from token (in order):

1. azp
2. client_id
3. sub

Matching logic:

1. Resolve token client identity.
2. Map identity to an AgentName using configured mapping.
3. Compare mapped agent to payload fromAgent.
4. Reject if missing mapping (when required) or mismatch.

This prevents a client for one agent from pretending to be another agent.

## Security Controls Implemented

### Discovery and Metadata

1. Agent Cards exposed by all agents.
2. Gateway registry aggregating all agent cards.
3. Discovery cache with TTL in caller.
4. Static route fallback for resilience.

### Authentication

1. OAuth 2.0 Client Credentials for caller-side token minting.
2. Optional per-target token endpoint, audience, and scope from environment, and optional credential hints from Agent Card authentication.credentials.
3. Optional global fallback bearer token (transitional only).

### Token Validation

1. Remote JWKS retrieval and cache.
2. Signature verification.
3. Issuer validation.
4. Audience validation.
5. Clock tolerance handling.

### Authorization

1. Required scope enforcement.
2. Client identity to agent binding enforcement.
3. fromAgent mismatch rejection.

### Auditability

Receiver logs include:

1. authSub
2. authClient
3. authMappedAgent

These fields support security incident tracing.

## Configuration Reference

All settings support either:

1. per-agent override: VARIABLE\_<AGENT_NAME>
2. global default: VARIABLE

### Discovery

1. A2A_DISCOVERY_ENABLED
2. A2A_REGISTRY_URL
3. A2A_DISCOVERY_CACHE_TTL_MS

### OAuth Client Credentials (caller side)

1. A2A_OAUTH_CLIENT_ID
2. A2A_OAUTH_CLIENT_SECRET
3. A2A_OAUTH_CLIENT_AUTH
4. A2A_OAUTH_TIMEOUT_MS
5. A2A_OAUTH_SCOPE
6. A2A_OAUTH_AUDIENCE
7. A2A_OAUTH_TOKEN_ENDPOINT

### Agent Card Metadata

1. A2A_AUTH_MODE
2. A2A_CARD_CREDENTIALS
3. A2A_PROVIDER_ORG
4. A2A_PROVIDER_URL
5. AGENT_CARD_VERSION

### JWT Validation (receiver side)

1. A2A_VALIDATE_JWT
2. A2A_JWKS_URI
3. A2A_TOKEN_ISSUER
4. A2A_AUDIENCE
5. A2A_REQUIRED_SCOPE
6. A2A_CLOCK_TOLERANCE_SEC

### fromAgent Binding and Client Mapping

1. A2A_ENFORCE_FROM_AGENT_BINDING
2. A2A_REQUIRE_CLIENT_AGENT_MAPPING
3. A2A_CLIENT_AGENT_MAP_JSON
4. A2A*CLIENT_ID*<AGENT_NAME>
5. A2A*CLIENT_IDS*<AGENT_NAME>

## Example: Strict Production Posture

1. Enable discovery:

- A2A_DISCOVERY_ENABLED=true
- A2A_REGISTRY_URL=https://api.example.com/api/registry/agents

2. Enable JWT validation:

- A2A_VALIDATE_JWT=true
- A2A_JWKS_URI=https://idp.example.com/.well-known/jwks.json
- A2A_TOKEN_ISSUER=https://idp.example.com/

3. Enforce scope and audience:

- A2A_AUDIENCE=OCR_PROCESSOR
- A2A_REQUIRED_SCOPE=a2a.invoke.ocr_processor

4. Enforce anti-spoofing:

- A2A_ENFORCE_FROM_AGENT_BINDING=true
- A2A_REQUIRE_CLIENT_AGENT_MAPPING=true

5. Configure explicit mapping:

- A2A_CLIENT_AGENT_MAP_JSON={"claims-receiver-client":"CLAIMS_RECEIVER","ocr-client":"OCR_PROCESSOR","icd-client":"ICD_CONVERTER","verification-client":"CUSTOMER_VERIFICATION","fraud-client":"FRAUD_DETECTION","payment-client":"PAYMENT_GENERATOR"}

## Rejection Cases and Error Codes

1. Missing token:

- HTTP 401
- A2A_AUTH_MISSING_TOKEN

2. Invalid token:

- HTTP 401
- A2A_AUTH_INVALID_TOKEN

3. Scope missing:

- HTTP 403
- A2A_AUTH_INSUFFICIENT_SCOPE

4. Invalid/missing payload fromAgent:

- HTTP 400
- A2A_INVALID_FROM_AGENT

5. Client identity not mapped:

- HTTP 403
- A2A_AUTH_CLIENT_MAPPING_MISSING

6. fromAgent mismatch:

- HTTP 403
- A2A_AUTH_FROM_AGENT_MISMATCH

## Security Boundaries and Notes

1. Authentication and authorization are enforced at each receiving agent.
2. Discovery data is not trusted alone; receiver still validates token and scope.
3. fromAgent payload is treated as untrusted until identity binding passes.
4. Fallback bearer token exists for migration, but should be disabled in strict production.
5. Use HTTPS for all service endpoints and IdP endpoints.

## Recommended Next Hardening Steps

1. Add jti replay protection for critical A2A message types.
2. Add explicit messageType authorization matrix by caller agent.
3. Add mTLS between services for network-level identity and encryption-in-transit hardening.
4. Add automated integration tests for allow/deny security cases.

## Related Implementation Files

1. packages/shared/src/a2a.ts
2. packages/shared/src/a2a-auth.ts
3. packages/shared/src/base-agent.ts
4. packages/shared/src/types.ts
5. packages/gateway/src/index.ts
6. .env.dev.example
7. .env.prod.example
