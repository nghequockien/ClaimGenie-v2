import express, { Request, Response, Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { prismaClient, prismaReady } from "./prisma-client";
import {
  AgentName,
  AgentConfig,
  A2AMessage,
  A2A_MESSAGE_TYPES,
  AgentCard,
  TaskStatus,
  LogLevel,
} from "./types";
import { createLogger, Logger } from "./logger";
import { A2AClient } from "./a2a";
import { createA2AJwtValidationMiddleware } from "./a2a-auth";
import { validateAgentCard } from "./agent-card-schema";

export abstract class BaseAgent {
  protected name: AgentName;
  protected config: AgentConfig;
  protected prisma: typeof prismaClient;
  protected a2aClient: A2AClient;
  protected logger: Logger;
  protected app: express.Application;
  private port: number;

  constructor(name: AgentName, config: AgentConfig, port: number) {
    this.name = name;
    this.config = { maxRetries: 3, timeoutMs: 60000, ...config };
    this.port = port;
    this.prisma = prismaClient;
    this.a2aClient = new A2AClient(name);
    this.logger = createLogger(name);
    this.app = express();
    this.setupExpress();
  }

  private setupExpress() {
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true }));

    // Health check
    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({
        status: "healthy",
        agent: this.name,
        timestamp: new Date().toISOString(),
      });
    });

    // Agent card (A2A discovery metadata)
    this.app.get("/agent-card", (_req: Request, res: Response) => {
      const card = this.createAgentCard();
      const validation = validateAgentCard(card);

      if (!validation.success) {
        this.logger.error("Generated Agent Card failed schema validation", {
          errors: validation.errors,
        });
        res.status(500).json({
          error: "Invalid Agent Card generated",
          details: validation.errors,
        });
        return;
      }

      res.json(validation.data);
    });

    this.app.get(
      "/.well-known/agent-card.json",
      (_req: Request, res: Response) => {
        const card = this.createAgentCard();
        const validation = validateAgentCard(card);

        if (!validation.success) {
          this.logger.error("Generated Agent Card failed schema validation", {
            errors: validation.errors,
          });
          res.status(500).json({
            error: "Invalid Agent Card generated",
            details: validation.errors,
          });
          return;
        }

        res.json(validation.data);
      },
    );

    // A2A receive endpoint
    this.app.post(
      "/a2a/receive",
      createA2AJwtValidationMiddleware(this.name, this.logger),
      async (req: Request, res: Response) => {
        const message: A2AMessage = req.body;
        this.logger.info(`Received A2A message`, {
          type: message.messageType,
          from: message.fromAgent,
          authSub: req.headers["x-a2a-auth-sub"],
          authClient: req.headers["x-a2a-auth-client"],
          authMappedAgent: req.headers["x-a2a-auth-mapped-agent"],
        });

        try {
          const reply = await this.handleA2AMessage(message);
          res.json(reply);
        } catch (err: any) {
          this.logger.error("A2A handler error", { error: err.message });
          res.status(500).json({
            id: uuidv4(),
            protocol: "A2A/1.0",
            timestamp: new Date().toISOString(),
            correlationId: message.correlationId,
            fromAgent: this.name,
            toAgent: message.fromAgent,
            messageType: "TASK_ERROR",
            payload: { error: err.message },
          } as A2AMessage);
        }
      },
    );

    // Manual retry endpoint
    this.app.post("/retry/:taskId", async (req: Request, res: Response) => {
      const { taskId } = req.params;
      try {
        const result = await this.retryTask(taskId);
        res.json({ success: true, result });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // Register agent-specific routes
    this.registerRoutes(this.app);
  }

  protected abstract handleA2AMessage(message: A2AMessage): Promise<A2AMessage>;
  protected abstract processTask(
    claimId: string,
    taskId: string,
    data: unknown,
  ): Promise<unknown>;
  protected registerRoutes(_app: express.Application): void {}

  protected createAgentCard(): AgentCard {
    const publicUrl =
      process.env[`${this.name}_PUBLIC_URL`] || `http://localhost:${this.port}`;
    const documentationUrl = process.env[`${this.name}_DOCS_URL`];
    const providerOrg = process.env.A2A_PROVIDER_ORG;
    const providerUrl = process.env.A2A_PROVIDER_URL;
    const authMode = process.env.A2A_AUTH_MODE || "none";

    return {
      name: this.name,
      description: `${this.name} agent for insurance claims workflow`,
      url: publicUrl,
      provider:
        providerOrg && providerUrl
          ? { organization: providerOrg, url: providerUrl }
          : undefined,
      version: process.env.AGENT_CARD_VERSION || "1.0.0",
      documentationUrl,
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
      },
      authentication: {
        schemes: authMode === "oauth2_client_credentials" ? ["Bearer"] : [],
        credentials: process.env.A2A_CARD_CREDENTIALS,
      },
      defaultInputModes: ["application/json"],
      defaultOutputModes: ["application/json"],
      skills: [
        {
          id: `${this.name.toLowerCase()}.a2a`,
          name: `${this.name} A2A Processing`,
          description: `Handle A2A tasks for ${this.name}`,
          tags: ["insurance", "claims", "a2a"],
          examples: A2A_MESSAGE_TYPES.map((type) => `${type} message`),
        },
      ],
    };
  }

  private toJsonString(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  }

  private isTransientDbError(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "";

    return (
      message.includes("Operation has timed out") ||
      message.includes("SQLITE_BUSY") ||
      message.includes("database is locked")
    );
  }

  private async delay(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async withDbWriteRetry<T>(
    operationName: string,
    action: () => Promise<T>,
    options: { retries?: number; swallowFinalError?: boolean } = {},
  ): Promise<T | undefined> {
    const retries = options.retries ?? 3;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        const isRetryable = this.isTransientDbError(error);
        const isLastAttempt = attempt === retries;

        if (!isRetryable || isLastAttempt) {
          if (options.swallowFinalError) {
            this.logger.warn(
              `${operationName} skipped after database write retries`,
              {
                error: error instanceof Error ? error.message : String(error),
              },
            );
            return undefined;
          }

          throw error;
        }

        await this.delay(150 * (attempt + 1));
      }
    }

    return undefined;
  }

  private parseJsonIfString(value: unknown): unknown {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  protected async createTask(
    claimId: string,
    input?: unknown,
    agentName?: AgentName,
  ): Promise<string> {
    const task = await this.withDbWriteRetry("createTask", () =>
      this.prisma.agentTask.create({
        data: {
          claimId,
          agentName: agentName ?? this.name,
          status: "PENDING",
          input: this.toJsonString(input),
          maxRetries: this.config.maxRetries ?? 3,
        },
      }),
    );

    if (!task) {
      throw new Error("Failed to create task");
    }
    return task.id;
  }

  protected async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    output?: unknown,
    errorMsg?: string,
  ) {
    const data: any = { status, updatedAt: new Date() };
    if (status === "RUNNING") data.startedAt = new Date();
    if (
      status === "COMPLETED" ||
      status === "FAILED" ||
      status === "ALERT" ||
      status === "WARNING"
    ) {
      data.completedAt = new Date();
      const task = await this.prisma.agentTask.findUnique({
        where: { id: taskId },
      });
      if (task?.startedAt) {
        data.duration = Date.now() - task.startedAt.getTime();
      }
    }
    if (output !== undefined) data.output = this.toJsonString(output);
    if (errorMsg !== undefined) data.errorMsg = errorMsg;

    await this.withDbWriteRetry("updateTaskStatus", () =>
      this.prisma.agentTask.update({ where: { id: taskId }, data }),
    );
  }

  protected async log(
    claimId: string,
    level: LogLevel,
    message: string,
    details?: unknown,
    taskId?: string,
  ) {
    await this.withDbWriteRetry(
      "claimLog.create",
      () =>
        this.prisma.claimLog.create({
          data: {
            claimId,
            taskId,
            agentName: this.name,
            level,
            message,
            details: this.toJsonString(details),
          },
        }),
      { swallowFinalError: true },
    );
  }

  protected async recordEvent(
    claimId: string,
    eventType: string,
    payload?: unknown,
    toAgent?: AgentName,
  ) {
    await this.withDbWriteRetry("recordEvent", () =>
      this.prisma.claimEvent.create({
        data: {
          claimId,
          eventType,
          fromAgent: this.name,
          toAgent: toAgent as any,
          payload: this.toJsonString(payload),
        },
      }),
    );
  }

  protected async updateMetrics(success: boolean, duration?: number) {
    const existing = await this.prisma.systemMetrics.findUnique({
      where: { agentName: this.name },
    });

    if (existing) {
      await this.withDbWriteRetry("updateMetrics", () =>
        this.prisma.systemMetrics.update({
          where: { agentName: this.name },
          data: {
            totalProcessed: success
              ? { increment: 1 }
              : existing.totalProcessed,
            totalFailed: success ? existing.totalFailed : { increment: 1 },
            lastActiveAt: new Date(),
            avgDuration: duration
              ? existing.avgDuration
                ? (existing.avgDuration + duration) / 2
                : duration
              : existing.avgDuration,
          },
        }),
      );
    }
  }

  protected createReply(
    original: A2AMessage,
    type: A2AMessage["messageType"],
    payload: unknown,
  ): A2AMessage {
    return {
      id: uuidv4(),
      protocol: "A2A/1.0",
      timestamp: new Date().toISOString(),
      correlationId: original.correlationId,
      fromAgent: this.name,
      toAgent: original.fromAgent,
      messageType: type,
      payload,
      replyTo: original.id,
    };
  }

  async retryTask(taskId: string): Promise<unknown> {
    const task = await this.prisma.agentTask.findUnique({
      where: { id: taskId },
    });
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.retryCount >= task.maxRetries) {
      throw new Error(
        `Max retries (${task.maxRetries}) exceeded for task ${taskId}`,
      );
    }

    await this.prisma.agentTask.update({
      where: { id: taskId },
      data: { status: "RETRYING", retryCount: { increment: 1 } },
    });

    this.logger.info(
      `Retrying task ${taskId} (attempt ${task.retryCount + 1}/${task.maxRetries})`,
    );
    return this.processTask(
      task.claimId,
      taskId,
      this.parseJsonIfString(task.input),
    );
  }

  start() {
    void (async () => {
      try {
        await prismaReady;
        this.app.listen(this.port, () => {
          this.logger.info(
            `🤖 ${this.name} agent started on port ${this.port}`,
          );
        });
      } catch (err) {
        this.logger.error("Failed to initialize database", {
          error: (err as Error).message,
        });
        process.exit(1);
      }
    })();

    process.on("SIGTERM", async () => {
      this.logger.info("Shutting down...");
      await this.prisma.$disconnect();
      process.exit(0);
    });
  }
}
