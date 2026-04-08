import { v4 as uuidv4 } from "uuid";
import {
  A2AMessage,
  A2AMessageType,
  AgentCard,
  AgentName,
  AGENT_PORTS,
} from "./types";
import { createLogger } from "./logger";

const logger = createLogger();

type TokenResolver = (target: AgentCard) => Promise<string | null>;

type A2AClientOptions = {
  overrideUrls?: Partial<Record<AgentName, string>>;
  registryUrl?: string;
  discoveryEnabled?: boolean;
  discoveryCacheTtlMs?: number;
  tokenResolver?: TokenResolver;
};

type CachedAgentCard = {
  card: AgentCard;
  expiresAt: number;
};

type CachedAccessToken = {
  accessToken: string;
  expiresAt: number;
};

type AgentCardCredentialHints = {
  tokenEndpoint?: string;
  audience?: string;
  scope?: string;
};

export class A2AClient {
  private agentName: AgentName;
  private baseUrls: Record<AgentName, string>;
  private registryUrl: string;
  private discoveryEnabled: boolean;
  private discoveryCacheTtlMs: number;
  private tokenResolver?: TokenResolver;
  private discoveryCache: Partial<Record<AgentName, CachedAgentCard>> = {};
  private accessTokenCache: Record<string, CachedAccessToken> = {};

  constructor(agentName: AgentName, options: A2AClientOptions = {}) {
    this.agentName = agentName;
    this.registryUrl =
      options.registryUrl ||
      process.env.A2A_REGISTRY_URL ||
      "http://localhost:4000/api/registry/agents";
    this.discoveryEnabled =
      options.discoveryEnabled ?? process.env.A2A_DISCOVERY_ENABLED !== "false";
    this.discoveryCacheTtlMs =
      options.discoveryCacheTtlMs ||
      Number(process.env.A2A_DISCOVERY_CACHE_TTL_MS || 60000);
    this.tokenResolver = options.tokenResolver;

    this.baseUrls = Object.entries(AGENT_PORTS).reduce(
      (acc, [name, port]) => {
        const host = process.env[`${name}_HOST`] || "localhost";
        acc[name as AgentName] =
          options.overrideUrls?.[name as AgentName] || `http://${host}:${port}`;
        return acc;
      },
      {} as Record<AgentName, string>,
    );
  }

  private fallbackAgentCard(agent: AgentName): AgentCard {
    const baseUrl = this.baseUrls[agent];
    return {
      name: agent,
      description: `${agent} fallback card`,
      url: baseUrl,
      version: "fallback",
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
      },
      authentication: { schemes: [] },
      defaultInputModes: ["application/json"],
      defaultOutputModes: ["application/json"],
      skills: [
        {
          id: `${agent.toLowerCase()}.a2a`,
          name: `${agent} A2A Processing`,
          description: `Handle A2A tasks for ${agent}`,
          tags: ["insurance", "claims", "a2a"],
        },
      ],
    };
  }

  private getTargetAgentName(target: AgentCard): AgentName | undefined {
    const normalized = target.name?.trim().toUpperCase().replace(/-/g, "_");
    if (!normalized) return undefined;
    return normalized as AgentName;
  }

  private parseCardCredentialHints(
    target: AgentCard,
  ): AgentCardCredentialHints {
    const raw = target.authentication?.credentials;
    if (!raw) return {};

    try {
      const parsed = JSON.parse(raw) as AgentCardCredentialHints;
      return {
        tokenEndpoint: parsed.tokenEndpoint,
        audience: parsed.audience,
        scope: parsed.scope,
      };
    } catch {
      return {};
    }
  }

  private async discoverAgentCard(agent: AgentName): Promise<AgentCard> {
    const cacheHit = this.discoveryCache[agent];
    if (cacheHit && cacheHit.expiresAt > Date.now()) {
      return cacheHit.card;
    }

    if (!this.discoveryEnabled) {
      return this.fallbackAgentCard(agent);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(`${this.registryUrl}/${agent}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Discovery failed: ${response.status} ${response.statusText}`,
        );
      }

      const body = (await response.json()) as { agent?: AgentCard } | AgentCard;
      const card = (body as { agent?: AgentCard }).agent || (body as AgentCard);

      if (!card?.url) {
        throw new Error("Discovery payload missing url");
      }

      this.discoveryCache[agent] = {
        card,
        expiresAt: Date.now() + this.discoveryCacheTtlMs,
      };

      return card;
    } catch (error) {
      logger.warn("A2A discovery fallback to static route", {
        target: agent,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.fallbackAgentCard(agent);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolveBearerToken(target: AgentCard): Promise<string | null> {
    if (this.tokenResolver) {
      return this.tokenResolver(target);
    }

    const targetAgentName = this.getTargetAgentName(target);
    const scopedEnvToken = targetAgentName
      ? process.env[`A2A_TOKEN_${targetAgentName}`]
      : undefined;
    if (scopedEnvToken) return scopedEnvToken;

    if (target.authentication?.schemes?.includes("Bearer")) {
      return this.acquireOAuthAccessToken(target);
    }

    return process.env.A2A_BEARER_TOKEN || null;
  }

  private resolveTargetOAuthValue(
    prefix: string,
    target: AgentCard,
  ): string | undefined {
    const targetAgentName = this.getTargetAgentName(target);
    return (
      (targetAgentName
        ? process.env[`${prefix}_${targetAgentName}`]
        : undefined) ||
      process.env[prefix] ||
      undefined
    );
  }

  private decodeJwtExp(accessToken: string): number | null {
    try {
      const parts = accessToken.split(".");
      if (parts.length < 2) return null;
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8"),
      ) as { exp?: number };
      if (!payload.exp || Number.isNaN(payload.exp)) return null;
      return payload.exp * 1000;
    } catch {
      return null;
    }
  }

  private async acquireOAuthAccessToken(target: AgentCard): Promise<string> {
    const targetAgentName = this.getTargetAgentName(target) || target.name;
    const credentialHints = this.parseCardCredentialHints(target);

    const tokenEndpoint =
      credentialHints.tokenEndpoint ||
      this.resolveTargetOAuthValue("A2A_OAUTH_TOKEN_ENDPOINT", target) ||
      process.env.A2A_TOKEN_ENDPOINT;

    if (!tokenEndpoint) {
      throw new Error(
        `Missing OAuth token endpoint for ${targetAgentName}. Set credentials JSON in Agent Card or A2A_OAUTH_TOKEN_ENDPOINT(_${targetAgentName}).`,
      );
    }

    const clientId =
      this.resolveTargetOAuthValue("A2A_OAUTH_CLIENT_ID", target) ||
      process.env.A2A_CLIENT_ID;
    const clientSecret =
      this.resolveTargetOAuthValue("A2A_OAUTH_CLIENT_SECRET", target) ||
      process.env.A2A_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        `Missing OAuth client credentials for ${targetAgentName}. Set A2A_OAUTH_CLIENT_ID/A2A_OAUTH_CLIENT_SECRET.`,
      );
    }

    const scope =
      credentialHints.scope ||
      this.resolveTargetOAuthValue("A2A_OAUTH_SCOPE", target) ||
      undefined;
    const audience =
      credentialHints.audience ||
      this.resolveTargetOAuthValue("A2A_OAUTH_AUDIENCE", target) ||
      undefined;

    const cacheKey = `${tokenEndpoint}|${clientId}|${scope || ""}|${audience || ""}`;
    const cacheHit = this.accessTokenCache[cacheKey];
    if (cacheHit && cacheHit.expiresAt > Date.now()) {
      return cacheHit.accessToken;
    }

    const authMethod =
      process.env.A2A_OAUTH_CLIENT_AUTH || "client_secret_post";
    const timeoutMs = Number(process.env.A2A_OAUTH_TIMEOUT_MS || 5000);
    const params = new URLSearchParams();
    params.set("grant_type", "client_credentials");
    if (scope) params.set("scope", scope);
    if (audience) params.set("audience", audience);

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };

    if (authMethod === "client_secret_basic") {
      headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    } else {
      params.set("client_id", clientId);
      params.set("client_secret", clientSecret);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers,
        body: params.toString(),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `OAuth token request failed for ${targetAgentName}: ${response.status} ${response.statusText} - ${body}`,
        );
      }

      const tokenResponse = (await response.json()) as {
        access_token?: string;
        token_type?: string;
        expires_in?: number;
      };

      const accessToken = tokenResponse.access_token;
      if (!accessToken) {
        throw new Error(
          `OAuth token response missing access_token for ${targetAgentName}`,
        );
      }

      const expiresInSec = Number(tokenResponse.expires_in || 0);
      const safetyWindowMs = 30000;
      const jwtExpMs = this.decodeJwtExp(accessToken);
      const fromExpiresIn =
        expiresInSec > 0
          ? Date.now() + Math.max(1, expiresInSec) * 1000 - safetyWindowMs
          : null;
      const expiresAt =
        fromExpiresIn && fromExpiresIn > Date.now()
          ? fromExpiresIn
          : jwtExpMs && jwtExpMs > Date.now()
            ? jwtExpMs - safetyWindowMs
            : Date.now() + 5 * 60 * 1000;

      this.accessTokenCache[cacheKey] = {
        accessToken,
        expiresAt,
      };

      return accessToken;
    } finally {
      clearTimeout(timeout);
    }
  }

  createMessage(
    toAgent: AgentName | "BROADCAST",
    messageType: A2AMessageType,
    correlationId: string,
    payload: unknown,
  ): A2AMessage {
    return {
      id: uuidv4(),
      protocol: "A2A/1.0",
      timestamp: new Date().toISOString(),
      correlationId,
      fromAgent: this.agentName,
      toAgent,
      messageType,
      payload,
    };
  }

  async send(
    toAgent: AgentName,
    messageType: A2AMessageType,
    correlationId: string,
    payload: unknown,
    timeoutMs = 60000,
  ): Promise<A2AMessage> {
    const message = this.createMessage(
      toAgent,
      messageType,
      correlationId,
      payload,
    );
    const target = await this.discoverAgentCard(toAgent);
    const url = `${target.url.replace(/\/$/, "")}/a2a/receive`;
    const bearerToken = await this.resolveBearerToken(target);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-A2A-Protocol": "A2A/1.0",
      "X-A2A-From": this.agentName,
      "X-A2A-Discovery": this.discoveryEnabled ? "registry" : "static",
    };

    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }

    logger.info(`A2A → ${toAgent}`, {
      messageId: message.id,
      type: messageType,
      correlationId,
      endpoint: url,
      authSchemes: target.authentication?.schemes,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `A2A request failed: ${response.status} ${response.statusText}`,
        );
      }

      const reply = (await response.json()) as A2AMessage;
      logger.info(`A2A ← ${toAgent}`, {
        messageId: reply.id,
        type: reply.messageType,
      });
      return reply;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(
          `A2A timeout after ${timeoutMs}ms sending to ${toAgent}`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendParallel(
    targets: AgentName[],
    messageType: A2AMessageType,
    correlationId: string,
    payloads: Record<AgentName, unknown>,
    timeoutMs = 60000,
  ): Promise<Record<AgentName, A2AMessage | Error>> {
    const promises = targets.map(async (agent) => {
      try {
        const result = await this.send(
          agent,
          messageType,
          correlationId,
          payloads[agent],
          timeoutMs,
        );
        return [agent, result] as const;
      } catch (err) {
        return [
          agent,
          err instanceof Error ? err : new Error(String(err)),
        ] as const;
      }
    });

    const results = await Promise.allSettled(promises);
    const output: Record<AgentName, A2AMessage | Error> = {} as any;

    for (const result of results) {
      if (result.status === "fulfilled") {
        const [agent, value] = result.value;
        output[agent] = value;
      }
    }

    return output;
  }

  getUrl(agent: AgentName): string {
    return this.baseUrls[agent];
  }
}

// SSE event emitter for real-time log streaming
export class SSEEmitter {
  private clients: Set<(data: string) => void> = new Set();

  addClient(cb: (data: string) => void) {
    this.clients.add(cb);
    return () => this.clients.delete(cb);
  }

  emit(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.clients.forEach((cb) => cb(payload));
  }

  get clientCount() {
    return this.clients.size;
  }
}

export const globalSSE = new SSEEmitter();
