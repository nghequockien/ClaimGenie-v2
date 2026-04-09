import express from "express";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import session from "express-session";
import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import { createAuthModule } from "@claimgenie/auth";
import {
  createLogger,
  AGENT_PORTS,
  AgentCard,
  AgentName,
  validateAgentCard,
  prismaClient,
  prismaReady,
} from "@claimgenie/shared";

const logger = createLogger();
const PORT = parseInt(process.env.GATEWAY_PORT || "4000");
const UI_URL = process.env.UI_URL || "http://localhost:5173";
const SESSION_SECRET = process.env.SESSION_SECRET || "claimgenie-dev-secret";
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
);

const app = express();

type ClaimLogRow = {
  id: string;
  claimId: string;
  taskId: string | null;
  agentName: string | null;
  level: string;
  message: string;
  details: string | null;
  timestamp: Date;
};

type ClaimLogDelegate = {
  findMany: (args: {
    where?: { timestamp?: { gt?: Date } };
    orderBy?: { timestamp: "asc" | "desc" };
    take?: number;
  }) => Promise<ClaimLogRow[]>;
};

const claimLogStore = (
  prismaClient as unknown as { claimLog: ClaimLogDelegate }
).claimLog;
let lastBroadcastedLogAt = new Date();
const authModule = createAuthModule({
  prisma: prismaClient as any,
  logger,
  port: PORT,
  uiUrl: UI_URL,
  adminEmails: ADMIN_EMAILS,
});
const requireAdmin = authModule.requireAdmin;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
function isAllowedOrigin(origin: string | undefined) {
  if (!origin) return true;

  const allowList = (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  if (allowList.includes(origin)) {
    return true;
  }

  if (process.env.NODE_ENV !== "production") {
    try {
      const parsed = new URL(origin);
      const isLocalHost =
        parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (isLocalHost && ["http:", "https:"].includes(parsed.protocol)) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-A2A-Protocol",
      "X-A2A-From",
    ],
  }),
);

app.use(
  compression({
    filter: (req, res) => {
      if (req.path === "/api/events") return false;
      return compression.filter(req, res);
    },
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(
  session({
    name: "claimgenie.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/api/events", // Don't rate limit SSE
});
app.use("/api/", limiter);

// ─── SSE GLOBAL BROADCAST ─────────────────────────────────────────────────────
const sseClients: Set<express.Response> = new Set();

app.get("/api/events", (req, res) => {
  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Accel-Buffering", "no");

  // Flush headers immediately so browser fires EventSource 'open'.
  res.flushHeaders();

  sseClients.add(res);
  logger.info(`SSE client connected. Total: ${sseClients.size}`);

  // Send a comment to start the stream (no data yet)
  res.write(": SSE stream started\n\n");

  // Send recent logs so Monitoring has immediate context when opened.
  void (async () => {
    try {
      const recentLogs = await claimLogStore.findMany({
        orderBy: { timestamp: "desc" },
        take: 40,
      });
      recentLogs.reverse().forEach((log) => {
        res.write(`data: ${JSON.stringify(serializeClaimLog(log))}\n\n`);
      });
    } catch (err) {
      logger.warn("Failed to send recent logs to SSE client", {
        error: (err as Error).message,
      });
    }
  })();

  // Keep-alive with simple comment
  const keepAlive = setInterval(() => {
    try {
      res.write(": keep-alive\n\n");
    } catch (err) {
      logger.debug("Keep-alive write failed, cleaning up");
      clearInterval(keepAlive);
      sseClients.delete(res);
    }
  }, 30000); // 30 seconds

  req.on("close", () => {
    sseClients.delete(res);
    clearInterval(keepAlive);
    logger.info(`SSE client disconnected. Total: ${sseClients.size}`);
  });

  req.on("aborted", () => {
    logger.info("SSE client aborted connection");
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// Broadcast to all SSE clients
function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  });
}

function broadcastMessage(data: unknown) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  });
}

function serializeClaimLog(log: ClaimLogRow) {
  return {
    id: log.id,
    claimId: log.claimId,
    taskId: log.taskId || undefined,
    agentName: log.agentName || undefined,
    level: log.level,
    message: log.message,
    details: log.details,
    timestamp: log.timestamp.toISOString(),
  };
}

async function startClaimLogBridge() {
  try {
    const latest = await claimLogStore.findMany({
      orderBy: { timestamp: "desc" },
      take: 1,
    });
    if (latest.length > 0) {
      lastBroadcastedLogAt = latest[0].timestamp;
    }
  } catch (err) {
    logger.warn("Unable to initialize claim log bridge cursor", {
      error: (err as Error).message,
    });
  }

  setInterval(async () => {
    try {
      const newLogs = await claimLogStore.findMany({
        where: { timestamp: { gt: lastBroadcastedLogAt } },
        orderBy: { timestamp: "asc" },
        take: 200,
      });

      if (newLogs.length === 0) return;

      newLogs.forEach((log) => {
        broadcastMessage(serializeClaimLog(log));
      });
      lastBroadcastedLogAt = newLogs[newLogs.length - 1].timestamp;
    } catch (err) {
      logger.warn("Claim log bridge poll failed", {
        error: (err as Error).message,
      });
    }
  }, 1000);
}

// ─── AUTHENTICATION (SSO + SESSION) ──────────────────────────────────────────
authModule.registerRoutes(app);

// Direct metrics endpoint (debug)
app.get("/api/metrics", async (req, res) => {
  logger.info("Direct /api/metrics handler called");
  try {
    const host = agentHost("CLAIMS_RECEIVER");
    const port = AGENT_PORTS.CLAIMS_RECEIVER;
    const metricsUrl = `http://${host}:${port}/metrics`;
    logger.info(`Fetching metrics from ${metricsUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(metricsUrl, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    logger.error("Error fetching metrics", { error: err.message });
    res
      .status(502)
      .json({ error: "Metrics service unavailable", details: err.message });
  }
});

app.get("/api/health/agents", async (_, res) => {
  const results: Record<string, any> = {};

  await Promise.allSettled(
    Object.entries(AGENT_PORTS).map(async ([name, port]) => {
      const host = process.env[`${name}_HOST`] || "localhost";
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`http://${host}:${port}/health`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        results[name] = { status: response.ok ? "healthy" : "unhealthy", port };
      } catch {
        results[name] = { status: "unreachable", port };
      }
    }),
  );

  res.json({ agents: results, timestamp: new Date().toISOString() });
});

// ─── PROXY ROUTES ─────────────────────────────────────────────────────────────
function agentHost(name: AgentName) {
  return process.env[`${name}_HOST`] || "localhost";
}

async function fetchAgentCardFromAgent(name: AgentName): Promise<AgentCard> {
  const host = agentHost(name);
  const port = AGENT_PORTS[name];
  const fallbackBaseUrl = `http://${host}:${port}`;

  const fallbackCard: AgentCard = {
    name,
    description: `${name} fallback card`,
    url: fallbackBaseUrl,
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
        id: `${name.toLowerCase()}.a2a`,
        name: `${name} A2A Processing`,
        description: `Handle A2A tasks for ${name}`,
        tags: ["insurance", "claims", "a2a"],
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`http://${host}:${port}/agent-card`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      return fallbackCard;
    }

    const rawCard = (await response.json()) as unknown;
    const validation = validateAgentCard(rawCard);
    if (!validation.success) {
      logger.warn("Invalid Agent Card received from agent. Using fallback.", {
        agent: name,
        errors: validation.errors,
      });
      return fallbackCard;
    }

    return validation.data;
  } catch {
    return fallbackCard;
  } finally {
    clearTimeout(timeout);
  }
}

app.get("/api/registry/agents", async (_req, res) => {
  const results = await Promise.allSettled(
    (Object.keys(AGENT_PORTS) as AgentName[]).map(async (name) =>
      fetchAgentCardFromAgent(name),
    ),
  );

  const agents = results
    .filter(
      (result): result is PromiseFulfilledResult<AgentCard> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value);

  res.json({ agents, timestamp: new Date().toISOString() });
});

app.get("/api/registry/agents/:agentName", async (req, res) => {
  const normalized = req.params.agentName
    .trim()
    .toUpperCase()
    .replace(/-/g, "_") as AgentName;

  if (!(normalized in AGENT_PORTS)) {
    res.status(404).json({ error: `Unknown agent: ${req.params.agentName}` });
    return;
  }

  const agent = await fetchAgentCardFromAgent(normalized);
  res.json({ agent, timestamp: new Date().toISOString() });
});

// Claims Receiver - main claims API
app.use(
  "/api/claims",
  createProxyMiddleware({
    target: `http://${agentHost("CLAIMS_RECEIVER")}:${AGENT_PORTS.CLAIMS_RECEIVER}`,
    changeOrigin: true,
    pathRewrite: (path) => {
      // Convert /api/claims -> /claims, also handle /api/claims/xxx -> /claims/xxx
      if (path.startsWith("/api/claims")) {
        return path.replace(/^\/api\/claims/, "/claims") || "/claims";
      }
      return path.includes("/claims") ? path : `/claims${path}`;
    },
    on: {
      proxyReq: (proxyReq, req) => {
        // Set custom headers BEFORE fixRequestBody — fixRequestBody calls
        // proxyReq.write() which flushes headers, making setHeader fail afterward.
        const expressReq = req as express.Request & {
          session?: { user?: Record<string, unknown> };
        };
        const sessionUser = expressReq.session?.user;
        if (sessionUser) {
          if (sessionUser.id) {
            proxyReq.setHeader("x-submitter-id", String(sessionUser.id));
          }
          if (sessionUser.email) {
            proxyReq.setHeader("x-submitter-email", String(sessionUser.email));
          }
          if (sessionUser.name) {
            proxyReq.setHeader("x-submitter-name", String(sessionUser.name));
          }
          if (sessionUser.role) {
            proxyReq.setHeader("x-submitter-role", String(sessionUser.role));
          }
          if (sessionUser.provider) {
            proxyReq.setHeader(
              "x-submitter-provider",
              String(sessionUser.provider),
            );
          }
        }

        // Re-write the body for POST/PUT/PATCH after express.json() consumed it.
        // Must come after setHeader calls since write() flushes the header frame.
        fixRequestBody(proxyReq, req);

        logger.info(`CLAIMS_RECEIVER ${req.method} ${req.url}`);
      },
      error: (err, _req, res) => {
        logger.error("Proxy error to CLAIMS_RECEIVER", {
          error: (err as Error).message,
        });
        (res as express.Response)
          .status(502)
          .json({ error: "Claims service unavailable" });
      },
    },
  }),
);

// Metrics
app.use(
  "/api/metrics",
  createProxyMiddleware({
    target: `http://${agentHost("CLAIMS_RECEIVER")}:${AGENT_PORTS.CLAIMS_RECEIVER}`,
    changeOrigin: true,
    timeout: 10000,
    proxyTimeout: 10000,
    pathRewrite: (path) => {
      if (path.startsWith("/api/metrics")) {
        return path.replace(/^\/api\/metrics/, "/metrics") || "/metrics";
      }
      return path;
    },
    on: {
      proxyReq: (_proxyReq, req) => {
        logger.info(`METRICS proxy ${req.method} ${req.url}`);
      },
      proxyRes: (_proxyRes, req, res) => {
        logger.info(`METRICS response ${req.method} ${req.url}`);
      },
      error: (err, _req, res) => {
        logger.error("Proxy error to CLAIMS_RECEIVER /metrics", {
          error: (err as Error).message,
        });
        const response = res as express.Response;
        if (!response.headersSent) {
          response.status(502).json({
            error: "Metrics service unavailable",
            details: (err as Error).message,
          });
        }
      },
    },
  }),
);

// Individual agent health
Object.entries(AGENT_PORTS).forEach(([name, port]) => {
  const lowerName = name.toLowerCase();

  app.use(
    `/api/agents/${lowerName}/health`,
    createProxyMiddleware({
      target: `http://${agentHost(name as AgentName)}:${port}`,
      changeOrigin: true,
      pathRewrite: (path) => {
        const pattern = new RegExp(`^/api/agents/${lowerName}/health`);
        return path.replace(pattern, "/health") || "/health";
      },
    }),
  );

  app.use(
    `/api/agents/${lowerName}/retry`,
    createProxyMiddleware({
      target: `http://${agentHost(name as AgentName)}:${port}`,
      changeOrigin: true,
      pathRewrite: (path) => {
        const pattern = new RegExp(`^/api/agents/${lowerName}/retry`);
        return path.replace(pattern, "/retry") || "/retry";
      },
    }),
  );
});

// ─── AGENT CONFIGURATION ──────────────────────────────────────────────────────
const LLM_PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic Claude",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
  },
  {
    id: "openai",
    name: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  },
  {
    id: "azure-openai",
    name: "Azure OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
];

type AgentConfigRow = {
  agentName: string;
  provider: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  agentCard: string | null;
  updatedAt: Date;
};

type AgentConfigDelegate = {
  findMany: (args: {
    where: { active: boolean };
    orderBy: { agentName: "asc" | "desc" };
  }) => Promise<AgentConfigRow[]>;
  findUnique: (args: {
    where: { agentName: string };
  }) => Promise<AgentConfigRow | null>;
  update: (args: {
    where: { agentName: string };
    data: {
      provider?: string;
      model?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      agentCard?: string | null;
    };
  }) => Promise<AgentConfigRow>;
};

const agentConfigStore = (
  prismaClient as unknown as { agentConfig: AgentConfigDelegate }
).agentConfig;

// Get available LLM providers and models
app.get("/api/agents/config/providers", requireAdmin, (_req, res) => {
  res.json(LLM_PROVIDERS);
});

// Get all agent configs from database
app.get("/api/agents/config", requireAdmin, async (_req, res) => {
  try {
    const configs = await agentConfigStore.findMany({
      where: { active: true },
      orderBy: { agentName: "asc" },
    });

    const configMap: Record<string, any> = {};
    configs.forEach((config) => {
      const parsedCard = config.agentCard
        ? (() => {
            try {
              return JSON.parse(config.agentCard);
            } catch {
              return null;
            }
          })()
        : null;

      configMap[config.agentName] = {
        agentName: config.agentName,
        provider: config.provider,
        model: config.model,
        systemPrompt: config.systemPrompt,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        agentCard: parsedCard,
        configurable: true,
        updatedAt: config.updatedAt.toISOString(),
      };
    });

    res.json(configMap);
  } catch (error: any) {
    logger.error("Error fetching agent configs", { error: error.message });
    res.status(500).json({ error: "Failed to fetch agent configurations" });
  }
});

// Get single agent config from database
app.get("/api/agents/config/:agentName", requireAdmin, async (req, res) => {
  try {
    const { agentName } = req.params;
    const config = await agentConfigStore.findUnique({
      where: { agentName: agentName.toUpperCase() },
    });

    if (!config) {
      return res.status(404).json({ error: `Agent ${agentName} not found` });
    }

    const parsedCard = config.agentCard
      ? (() => {
          try {
            return JSON.parse(config.agentCard);
          } catch {
            return null;
          }
        })()
      : null;

    res.json({
      agentName: config.agentName,
      provider: config.provider,
      model: config.model,
      systemPrompt: config.systemPrompt,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      agentCard: parsedCard,
      configurable: true,
      updatedAt: config.updatedAt.toISOString(),
    });
  } catch (error: any) {
    logger.error("Error fetching agent config", { error: error.message });
    res.status(500).json({ error: "Failed to fetch agent configuration" });
  }
});

// Update agent config in database
app.put(
  "/api/agents/config/:agentName",
  requireAdmin,
  express.json(),
  async (req, res) => {
    try {
      const { agentName } = req.params;
      const {
        provider,
        model,
        systemPrompt,
        temperature,
        maxTokens,
        agentCard,
      } = req.body;

      // Validate agentCard if provided — may arrive as object (axios) or string (curl)
      let agentCardObj: Record<string, any> | null | undefined;
      if (agentCard === undefined) {
        agentCardObj = undefined;
      } else if (agentCard === null || agentCard === "") {
        agentCardObj = null;
      } else {
        try {
          agentCardObj =
            typeof agentCard === "object"
              ? agentCard
              : JSON.parse(String(agentCard));
          // Basic validation: must be an object with required fields
          if (
            typeof agentCardObj !== "object" ||
            !agentCardObj?.schemaVersion ||
            !agentCardObj?.humanReadableId ||
            !agentCardObj?.name ||
            !agentCardObj?.description ||
            !agentCardObj?.authSchemes
          ) {
            return res.status(400).json({
              error:
                "agentCard must be a valid Agent Card JSON with schemaVersion, humanReadableId, name, description, and authSchemes",
            });
          }
        } catch {
          return res.status(400).json({ error: "agentCard is not valid JSON" });
        }
      }

      const normalizedTemperature =
        temperature === undefined || temperature === null
          ? undefined
          : Number(temperature);
      const normalizedMaxTokens =
        maxTokens === undefined || maxTokens === null
          ? undefined
          : Number(maxTokens);

      const updated = await agentConfigStore.update({
        where: { agentName: agentName.toUpperCase() },
        data: {
          provider: provider ?? undefined,
          model: model ?? undefined,
          systemPrompt: systemPrompt ?? undefined,
          temperature: Number.isFinite(normalizedTemperature)
            ? normalizedTemperature
            : undefined,
          maxTokens:
            typeof normalizedMaxTokens === "number" &&
            Number.isFinite(normalizedMaxTokens)
              ? Math.trunc(normalizedMaxTokens)
              : undefined,
          agentCard:
            agentCardObj === undefined
              ? undefined
              : agentCardObj === null
                ? null
                : JSON.stringify(agentCardObj),
        },
      });

      logger.info(`Agent config updated: ${agentName}`, {
        provider: updated.provider,
        model: updated.model,
      });

      const parsedCard = updated.agentCard
        ? (() => {
            try {
              return JSON.parse(updated.agentCard);
            } catch {
              return null;
            }
          })()
        : null;

      // Broadcast config change via SSE
      broadcast("agent-config-updated", {
        agentName: updated.agentName,
        provider: updated.provider,
        model: updated.model,
        systemPrompt: updated.systemPrompt,
        temperature: updated.temperature,
        maxTokens: updated.maxTokens,
        agentCard: parsedCard,
        updatedAt: updated.updatedAt.toISOString(),
      });

      res.json({
        agentName: updated.agentName,
        provider: updated.provider,
        model: updated.model,
        systemPrompt: updated.systemPrompt,
        temperature: updated.temperature,
        maxTokens: updated.maxTokens,
        agentCard: parsedCard,
        configurable: true,
        updatedAt: updated.updatedAt.toISOString(),
      });
    } catch (error: any) {
      logger.error("Error updating agent config", { error: error.message });
      res.status(500).json({ error: "Failed to update agent configuration" });
    }
  },
);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

async function startGateway() {
  try {
    await prismaReady;
    await authModule.ensureAuthTables();
    await startClaimLogBridge();

    app.listen(PORT, () => {
      logger.info(`🚪 API Gateway running on port ${PORT}`);
      logger.info(`📡 SSE endpoint: http://localhost:${PORT}/api/events`);
      logger.info("🤖 Agent ports (local dev):");
      Object.entries(AGENT_PORTS).forEach(([name, port]) => {
        const label = name
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        logger.info(`   ${label.padEnd(24)} → http://localhost:${port}`);
      });
    });
  } catch (err) {
    logger.error("Gateway startup failed", {
      error: (err as Error).message,
    });
    process.exit(1);
  }
}

void startGateway();

export { broadcast };
