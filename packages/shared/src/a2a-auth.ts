import { Request, Response, NextFunction, RequestHandler } from "express";
import { AgentName } from "./types";
import { Logger } from "./logger";

const AGENT_NAMES: AgentName[] = [
  "CLAIMS_RECEIVER",
  "OCR_PROCESSOR",
  "ICD_CONVERTER",
  "CUSTOMER_VERIFICATION",
  "FRAUD_DETECTION",
  "PAYMENT_GENERATOR",
];

type JoseRemoteJwks = Awaited<
  ReturnType<typeof loadJose>
>["createRemoteJWKSet"];
type JoseJwksResolver = ReturnType<JoseRemoteJwks>;

const jwksCache = new Map<string, JoseJwksResolver>();

async function loadJose() {
  return import("jose");
}

type JwtPayloadLike = {
  sub?: string;
  scope?: string;
  scp?: string;
  azp?: string;
  client_id?: string;
  [key: string]: unknown;
};

function resolveAgentEnv(
  prefix: string,
  agentName: AgentName,
): string | undefined {
  return (
    process.env[`${prefix}_${agentName}`] || process.env[prefix] || undefined
  );
}

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() !== "false";
}

function parseScopes(payload: JwtPayloadLike): string[] {
  const raw =
    (typeof payload.scope === "string" ? payload.scope : undefined) ||
    (typeof payload.scp === "string" ? payload.scp : undefined) ||
    "";

  return raw
    .split(" ")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function normalizeAgentName(value: string | undefined): AgentName | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/-/g, "_");
  return AGENT_NAMES.includes(normalized as AgentName)
    ? (normalized as AgentName)
    : null;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildClientAgentMap(
  currentAgent: AgentName,
): Record<string, AgentName> {
  const map: Record<string, AgentName> = {};

  const rawJson = resolveAgentEnv("A2A_CLIENT_AGENT_MAP_JSON", currentAgent);
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, string>;
      Object.entries(parsed).forEach(([identity, targetAgent]) => {
        const normalizedAgent = normalizeAgentName(targetAgent);
        if (identity && normalizedAgent) {
          map[identity] = normalizedAgent;
        }
      });
    } catch {
      // Ignore malformed JSON and continue with env-based mapping.
    }
  }

  AGENT_NAMES.forEach((agent) => {
    const single = process.env[`A2A_CLIENT_ID_${agent}`];
    const many = process.env[`A2A_CLIENT_IDS_${agent}`];
    [...parseCsv(single), ...parseCsv(many)].forEach((identity) => {
      map[identity] = agent;
    });
  });

  return map;
}

function getBearerToken(req: Request): string | null {
  const authorization = req.headers.authorization;
  if (!authorization) return null;

  const [scheme, token] = authorization.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;

  return token;
}

async function getJwksResolver(jwksUri: string): Promise<JoseJwksResolver> {
  const existing = jwksCache.get(jwksUri);
  if (existing) return existing;

  const { createRemoteJWKSet } = await loadJose();
  const resolver = createRemoteJWKSet(new URL(jwksUri));
  jwksCache.set(jwksUri, resolver);
  return resolver;
}

export function createA2AJwtValidationMiddleware(
  agentName: AgentName,
  logger: Logger,
): RequestHandler {
  const enabled = parseBoolean(
    resolveAgentEnv("A2A_VALIDATE_JWT", agentName),
    false,
  );

  if (!enabled) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const issuer = resolveAgentEnv("A2A_TOKEN_ISSUER", agentName);
  const audience =
    resolveAgentEnv("A2A_AUDIENCE", agentName) ||
    resolveAgentEnv("A2A_OAUTH_AUDIENCE", agentName) ||
    agentName;
  const requiredScope =
    resolveAgentEnv("A2A_REQUIRED_SCOPE", agentName) ||
    `a2a.invoke.${agentName.toLowerCase()}`;
  const jwksUri = resolveAgentEnv("A2A_JWKS_URI", agentName);
  const clockToleranceSec = Number(
    resolveAgentEnv("A2A_CLOCK_TOLERANCE_SEC", agentName) || 10,
  );
  const enforceFromAgentBinding = parseBoolean(
    resolveAgentEnv("A2A_ENFORCE_FROM_AGENT_BINDING", agentName),
    true,
  );
  const requireClientMapping = parseBoolean(
    resolveAgentEnv("A2A_REQUIRE_CLIENT_AGENT_MAPPING", agentName),
    true,
  );
  const clientAgentMap = buildClientAgentMap(agentName);

  if (!issuer || !jwksUri) {
    throw new Error(
      `A2A JWT validation enabled for ${agentName} but A2A_TOKEN_ISSUER or A2A_JWKS_URI is missing`,
    );
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = getBearerToken(req);
      if (!token) {
        res.status(401).json({
          error: "Missing bearer token",
          code: "A2A_AUTH_MISSING_TOKEN",
        });
        return;
      }

      const jwks = await getJwksResolver(jwksUri);
      const { jwtVerify } = await loadJose();

      const verification = await jwtVerify(token, jwks, {
        issuer,
        audience,
        clockTolerance: clockToleranceSec,
      });

      const payload = verification.payload as JwtPayloadLike;
      const scopes = parseScopes(payload);
      if (!scopes.includes(requiredScope)) {
        res.status(403).json({
          error: "Insufficient scope",
          code: "A2A_AUTH_INSUFFICIENT_SCOPE",
          requiredScope,
        });
        return;
      }

      if (enforceFromAgentBinding) {
        const claimedFromAgent = normalizeAgentName(
          typeof req.body?.fromAgent === "string"
            ? req.body.fromAgent
            : undefined,
        );

        if (!claimedFromAgent) {
          res.status(400).json({
            error: "Invalid or missing fromAgent in A2A payload",
            code: "A2A_INVALID_FROM_AGENT",
          });
          return;
        }

        const tokenClientIdentity =
          (typeof payload.azp === "string" && payload.azp) ||
          (typeof payload.client_id === "string" && payload.client_id) ||
          (typeof payload.sub === "string" && payload.sub) ||
          "";

        const mappedFromIdentity = tokenClientIdentity
          ? clientAgentMap[tokenClientIdentity]
          : undefined;

        if (!mappedFromIdentity && requireClientMapping) {
          res.status(403).json({
            error: "Unmapped OAuth client identity",
            code: "A2A_AUTH_CLIENT_MAPPING_MISSING",
          });
          return;
        }

        const inferredAgent =
          mappedFromIdentity || normalizeAgentName(tokenClientIdentity);

        if (!inferredAgent || inferredAgent !== claimedFromAgent) {
          res.status(403).json({
            error: "fromAgent does not match authenticated client identity",
            code: "A2A_AUTH_FROM_AGENT_MISMATCH",
            expectedFromAgent: inferredAgent,
            claimedFromAgent,
          });
          return;
        }

        req.headers["x-a2a-auth-mapped-agent"] = inferredAgent;
      }

      req.headers["x-a2a-auth-sub"] = String(payload.sub || "");
      req.headers["x-a2a-auth-client"] = String(
        payload.azp || payload.client_id || "",
      );
      req.headers["x-a2a-auth-scope"] = scopes.join(" ");

      next();
    } catch (error) {
      logger.warn("A2A JWT validation failed", {
        error: error instanceof Error ? error.message : String(error),
        agent: agentName,
      });

      res.status(401).json({
        error: "Invalid bearer token",
        code: "A2A_AUTH_INVALID_TOKEN",
      });
    }
  };
}
