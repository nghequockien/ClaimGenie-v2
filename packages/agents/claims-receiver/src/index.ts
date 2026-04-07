import express from "express";
import multer from "multer";
import { mkdirSync, promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  BaseAgent,
  A2AMessage,
  A2AClient,
  PARALLEL_AGENTS,
  AgentName,
  Claim,
  createLogger,
  LlmClient,
  resolveAgentLlmConfig,
  extractJsonObject,
} from "@claimgenie/shared";

const PORT = parseInt(process.env.PORT || "4001");
const logger = createLogger("CLAIMS_RECEIVER");
const configuredUploadRoot = (process.env.UPLOAD_DIR || "")
  .trim()
  .replace(/^['"]|['"]$/g, "");
const UPLOAD_ROOT = path.resolve(
  configuredUploadRoot || path.join(process.cwd(), "tmp", "uploads"),
);
const TEMP_UPLOAD_DIR = path.join(UPLOAD_ROOT, "_tmp");

mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: TEMP_UPLOAD_DIR,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

const uploadDocuments = upload.fields([
  { name: "documents", maxCount: 10 },
  { name: "document", maxCount: 1 },
]);

class ClaimsReceiverAgent extends BaseAgent {
  private llm: LlmClient;

  private async cleanupTempFiles(
    files?: Array<Express.Multer.File | undefined>,
  ) {
    if (!files?.length) return;
    await Promise.all(
      files.map(async (file) => {
        if (!file?.path) return;
        try {
          await fs.unlink(file.path);
        } catch {
          // Ignore cleanup errors (file may already be moved/deleted)
        }
      }),
    );
  }

  private sanitizeFilePart(value: string) {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  private getUploadedFiles(req: express.Request) {
    const files = req.files as
      | Record<string, Express.Multer.File[]>
      | Express.Multer.File[]
      | undefined;

    if (!files) return [];
    if (Array.isArray(files)) return files;
    return [...(files.documents ?? []), ...(files.document ?? [])];
  }

  private async moveUploadedDocument(
    uploadedFile: Express.Multer.File,
    claimId: string,
    createdAt: Date,
  ) {
    const year = String(createdAt.getFullYear());
    const month = String(createdAt.getMonth() + 1).padStart(2, "0");
    const day = String(createdAt.getDate()).padStart(2, "0");

    const targetDir = path.join(UPLOAD_ROOT, year, month, day, claimId);
    await fs.mkdir(targetDir, { recursive: true });

    const parsed = path.parse(
      uploadedFile.originalname || uploadedFile.filename,
    );
    const safeBaseName = this.sanitizeFilePart(parsed.name || "document");
    const safeExt = this.sanitizeFilePart(parsed.ext || "").toLowerCase();

    let candidateName = `${safeBaseName}${safeExt}`;
    let targetPath = path.join(targetDir, candidateName);
    let counter = 1;

    while (true) {
      try {
        await fs.access(targetPath);
        candidateName = `${safeBaseName}-${counter}${safeExt}`;
        targetPath = path.join(targetDir, candidateName);
        counter += 1;
      } catch {
        break;
      }
    }

    try {
      await fs.rename(uploadedFile.path, targetPath);
    } catch (err: any) {
      await fs.copyFile(uploadedFile.path, targetPath);
      await fs.unlink(uploadedFile.path);
    }

    return targetPath;
  }

  private async moveUploadedDocuments(
    uploadedFiles: Express.Multer.File[],
    claimId: string,
    createdAt: Date,
  ) {
    const storedPaths: string[] = [];

    for (const uploadedFile of uploadedFiles) {
      storedPaths.push(
        await this.moveUploadedDocument(uploadedFile, claimId, createdAt),
      );
    }

    return storedPaths;
  }

  private extractSubmitterInfo(req: express.Request) {
    const getHeaderValue = (name: string) => {
      const value = req.header(name);
      return value && value.trim() ? value.trim() : undefined;
    };

    const id = getHeaderValue("x-submitter-id");
    const email = getHeaderValue("x-submitter-email");
    const name = getHeaderValue("x-submitter-name");
    const role = getHeaderValue("x-submitter-role");
    const provider = getHeaderValue("x-submitter-provider");

    if (!id && !email && !name) {
      return undefined;
    }

    return {
      id,
      email,
      name,
      role,
      provider,
      submittedAt: new Date().toISOString(),
    };
  }

  private parseJsonField(value: unknown) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private getClaimDocumentPaths(claim: {
    documentPath?: string | null;
    metadata?: unknown;
  }) {
    const metadata = this.parseJsonField(claim.metadata);
    const metadataRecord =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : null;

    const rawDocumentPaths = Array.isArray(metadataRecord?.documentPaths)
      ? metadataRecord.documentPaths
      : [];

    const metadataDocumentPaths = rawDocumentPaths
      .filter((value: unknown): value is string => typeof value === "string")
      .filter((value: string) => value.length > 0);

    if (metadataDocumentPaths.length > 0) {
      return metadataDocumentPaths;
    }

    return claim.documentPath ? [claim.documentPath] : [];
  }

  private deserializeClaim<T extends Record<string, any>>(claim: T): T {
    return {
      ...claim,
      icdCodes: this.parseJsonField(claim.icdCodes),
      fraudFlags: this.parseJsonField(claim.fraudFlags),
      paymentData: this.parseJsonField(claim.paymentData),
      verificationData: this.parseJsonField(claim.verificationData),
      metadata: this.parseJsonField(claim.metadata),
      tasks: Array.isArray(claim.tasks)
        ? claim.tasks.map((task: any) => ({
            ...task,
            input: this.parseJsonField(task.input),
            output: this.parseJsonField(task.output),
          }))
        : claim.tasks,
      logs: Array.isArray(claim.logs)
        ? claim.logs.map((log: any) => ({
            ...log,
            details: this.parseJsonField(log.details),
          }))
        : claim.logs,
      events: Array.isArray(claim.events)
        ? claim.events.map((event: any) => ({
            ...event,
            payload: this.parseJsonField(event.payload),
          }))
        : claim.events,
    };
  }

  constructor() {
    const llmConfig = resolveAgentLlmConfig(
      "CLAIMS_RECEIVER",
      process.env.CLAUDE_MODEL || "claude-haiku-4-5",
    );

    super(
      "CLAIMS_RECEIVER",
      {
        name: "CLAIMS_RECEIVER",
        model: llmConfig.model,
        maxRetries: 3,
      },
      PORT,
    );
    this.llm = new LlmClient(llmConfig);
  }

  protected registerRoutes(app: express.Application) {
    // Submit new claim (JSON)
    app.post("/claims", async (req, res) => {
      try {
        const claimData = req.body;
        const result = await this.receiveClaim(
          claimData,
          null,
          this.extractSubmitterInfo(req),
        );
        res.status(201).json(result);
      } catch (err: any) {
        logger.error("Failed to receive claim", {
          error: err?.message,
          stack: err?.stack,
          payload: req.body,
        });
        res.status(500).json({
          error: "Failed to submit claim",
          details: err?.message || "Unknown error",
        });
      }
    });

    // Submit claim with document upload
    app.post("/claims/upload", uploadDocuments, async (req, res) => {
      try {
        const claimData = JSON.parse(req.body.claimData || "{}");
        const result = await this.receiveClaim(
          claimData,
          this.getUploadedFiles(req),
          this.extractSubmitterInfo(req),
        );
        res.status(201).json(result);
      } catch (err: any) {
        await this.cleanupTempFiles(this.getUploadedFiles(req));
        logger.error("Failed to receive claim with upload", {
          error: err.message,
        });
        res.status(500).json({ error: err.message });
      }
    });

    // List claims
    app.get("/claims", async (req, res) => {
      try {
        const {
          status,
          limit = "50",
          offset = "0",
          sortBy,
          sortDir,
        } = req.query;
        const where = status ? { status: status as any } : undefined;
        const validSortDir: "asc" | "desc" = sortDir === "asc" ? "asc" : "desc";
        // Priority sort is handled client-side; server always orders by createdAt
        const orderBy: any =
          sortBy === "priority"
            ? { createdAt: "desc" }
            : { createdAt: validSortDir };

        const [claims, total] = await Promise.all([
          this.prisma.claim.findMany({
            where,
            take: parseInt(limit as string),
            skip: parseInt(offset as string),
            orderBy,
            include: {
              tasks: true,
              logs: { orderBy: { timestamp: "desc" }, take: 20 },
            },
          }),
          this.prisma.claim.count({ where }),
        ]);

        res.json({
          claims: claims.map((claim) => this.deserializeClaim(claim as any)),
          total,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // Get single claim with all details
    app.get("/claims/:id", async (req, res) => {
      try {
        const claim = await this.prisma.claim.findUnique({
          where: { id: req.params.id },
          include: {
            tasks: { orderBy: { createdAt: "asc" } },
            logs: { orderBy: { timestamp: "asc" } },
            events: { orderBy: { timestamp: "asc" } },
          },
        });
        if (!claim) return res.status(404).json({ error: "Claim not found" });
        res.json(this.deserializeClaim(claim as any));
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get("/claims/:id/documents/:index/content", async (req, res) => {
      try {
        const claim = await this.prisma.claim.findUnique({
          where: { id: req.params.id },
          select: { id: true, documentPath: true, metadata: true },
        });
        if (!claim) {
          return res.status(404).json({ error: "Claim not found" });
        }

        const documentIndex = Number.parseInt(req.params.index, 10);
        if (!Number.isInteger(documentIndex) || documentIndex < 0) {
          return res.status(400).json({ error: "Invalid document index" });
        }

        const documentPaths = this.getClaimDocumentPaths(claim);
        const documentPath = documentPaths[documentIndex];
        if (!documentPath) {
          return res.status(404).json({ error: "Document not found" });
        }

        const resolvedUploadRoot = path.resolve(UPLOAD_ROOT);
        const resolvedDocumentPath = path.resolve(documentPath);
        const isWithinUploadRoot =
          resolvedDocumentPath === resolvedUploadRoot ||
          resolvedDocumentPath.startsWith(`${resolvedUploadRoot}${path.sep}`);

        if (!isWithinUploadRoot) {
          return res.status(403).json({ error: "Document access denied" });
        }

        await fs.access(resolvedDocumentPath);
        res.setHeader(
          "Content-Disposition",
          `inline; filename="${path.basename(resolvedDocumentPath)}"`,
        );
        return res.sendFile(resolvedDocumentPath);
      } catch (err: any) {
        if (err?.code === "ENOENT") {
          return res.status(404).json({ error: "Document not found" });
        }
        return res.status(500).json({ error: err.message });
      }
    });

    // Retry failed claim
    app.post("/claims/:id/retry", async (req, res) => {
      try {
        const claim = await this.prisma.claim.findUnique({
          where: { id: req.params.id },
        });
        if (!claim) return res.status(404).json({ error: "Claim not found" });

        // Reset failed tasks
        await this.prisma.agentTask.updateMany({
          where: { claimId: claim.id, status: "FAILED" },
          data: { status: "PENDING", retryCount: { increment: 1 } },
        });

        await this.prisma.claim.update({
          where: { id: claim.id },
          data: { status: "RECEIVED" },
        });

        await this.log(
          claim.id,
          "INFO",
          "Claim resubmitted for processing by user request",
        );
        void (async () => {
          const dispatchTaskId = await this.createTask(
            claim.id,
            { stage: "DISPATCH_PARALLEL_RETRY" },
            "CLAIMS_RECEIVER",
          );
          try {
            await this.dispatchParallelProcessing(claim as any, dispatchTaskId);
          } catch (err) {
            const message = (err as Error).message;
            logger.error("Background retry dispatch failed", {
              claimId: claim.id,
              error: message,
            });
            await this.log(claim.id, "ERROR", "Retry dispatch failed", {
              error: message,
            });
            await this.updateTaskStatus(
              dispatchTaskId,
              "FAILED",
              undefined,
              message,
            );
          }
        })();

        res.json({
          success: true,
          message: "Claim resubmitted for processing",
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // SSE stream for real-time claim logs
    app.get("/claims/:id/stream", async (req, res) => {
      const { id } = req.params;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");

      // Send existing logs first
      const logs = await this.prisma.claimLog.findMany({
        where: { claimId: id },
        orderBy: { timestamp: "asc" },
      });
      for (const log of logs) {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      }

      // Poll for new logs every second
      const pollInterval = setInterval(async () => {
        const latest = logs[logs.length - 1];
        const newLogs = await this.prisma.claimLog.findMany({
          where: {
            claimId: id,
            timestamp: latest ? { gt: latest.timestamp } : undefined,
          },
          orderBy: { timestamp: "asc" },
        });

        for (const log of newLogs) {
          logs.push(log);
          res.write(`data: ${JSON.stringify(log)}\n\n`);
        }

        // Check if completed
        const claim = await this.prisma.claim.findUnique({ where: { id } });
        if (claim?.status === "COMPLETED" || claim?.status === "FAILED") {
          res.write(
            `event: complete\ndata: ${JSON.stringify({ status: claim.status })}\n\n`,
          );
          clearInterval(pollInterval);
          res.end();
        }
      }, 1000);

      req.on("close", () => clearInterval(pollInterval));
    });

    // System metrics
    app.get("/metrics", async (_, res) => {
      const metrics = await this.prisma.systemMetrics.findMany();
      const claimsByStatus = await this.prisma.claim.groupBy({
        by: ["status"],
        _count: { status: true },
      });
      res.json({ agents: metrics, claimsByStatus });
    });
  }

  protected async handleA2AMessage(message: A2AMessage): Promise<A2AMessage> {
    if (message.messageType === "HANDOFF") {
      const payload = message.payload as any;
      await this.log(
        payload.claimId,
        "INFO",
        `Received handoff from ${message.fromAgent}`,
        payload,
      );

      // Finalize claim
      await this.finalizeClaimProcessing(payload.claimId, payload.data);

      return this.createReply(message, "TASK_RESPONSE", { received: true });
    }
    return this.createReply(message, "PONG", {});
  }

  protected async processTask(
    claimId: string,
    taskId: string,
    _data: unknown,
  ): Promise<unknown> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
    });
    if (!claim) throw new Error(`Claim ${claimId} not found`);
    await this.dispatchParallelProcessing(claim as any, taskId);
    return { dispatched: true };
  }

  private async receiveClaim(
    claimData: Partial<Claim>,
    uploadedFiles: Express.Multer.File[] | null,
    submitter?: {
      id?: string;
      email?: string;
      name?: string;
      role?: string;
      provider?: string;
      submittedAt: string;
    },
  ) {
    logger.info("Receiving new claim", { claimNumber: claimData.claimNumber });

    const requiredFields: Array<keyof Claim> = [
      "patientName",
      "patientDob",
      "patientId",
      "insuranceId",
      "providerId",
      "providerName",
      "dateOfService",
    ];
    const missingFields = requiredFields.filter(
      (field) => !claimData[field] || String(claimData[field]).trim() === "",
    );
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
    }

    const parsedTotalAmount = Number(claimData.totalAmount);
    if (!Number.isFinite(parsedTotalAmount) || parsedTotalAmount < 0) {
      throw new Error(
        `Invalid totalAmount: ${String(claimData.totalAmount)}. Must be a non-negative number.`,
      );
    }

    // Use Claude to validate and enrich claim data
    const validation = await this.validateWithAI(claimData);
    const parsedMetadata = this.parseJsonField(claimData.metadata);
    const baseMetadata =
      parsedMetadata && typeof parsedMetadata === "object"
        ? (parsedMetadata as Record<string, unknown>)
        : {};

    const claimNumber = claimData.claimNumber || `CLM-${Date.now()}`;
    const claimId = uuidv4();
    const createdAt = new Date();

    const storedDocumentPaths = uploadedFiles?.length
      ? await this.moveUploadedDocuments(uploadedFiles, claimId, createdAt)
      : [];
    const documentPath = storedDocumentPaths[0] ?? null;

    const claim = await this.prisma.claim.create({
      data: {
        id: claimId,
        claimNumber,
        patientName: claimData.patientName || "Unknown",
        patientDob: claimData.patientDob || "",
        patientId: claimData.patientId || "",
        insuranceId: claimData.insuranceId || "",
        providerId: claimData.providerId || "",
        providerName: claimData.providerName || "",
        dateOfService:
          claimData.dateOfService || new Date().toISOString().split("T")[0],
        diagnosis: claimData.diagnosis,
        treatmentDetails: claimData.treatmentDetails,
        totalAmount: parsedTotalAmount,
        currency: claimData.currency || "USD",
        documentPath: documentPath,
        submittedByUserId: submitter?.id,
        submittedByEmail: submitter?.email,
        submittedByName: submitter?.name,
        submittedByRole: submitter?.role,
        submittedByProvider: submitter?.provider,
        status: "RECEIVED",
        priority: claimData.priority || "NORMAL",
        metadata: JSON.stringify({
          ...baseMetadata,
          documentPaths: storedDocumentPaths,
          submittedBy: submitter,
          uploadRoot: UPLOAD_ROOT,
          validationNotes: validation.notes,
        }),
      },
    });

    await this.log(
      claim.id,
      "INFO",
      `Claim ${claimNumber} received and registered`,
      {
        patientName: claim.patientName,
        totalAmount: claim.totalAmount,
        priority: claim.priority,
        documentCount: storedDocumentPaths.length,
        submittedBy: submitter
          ? {
              id: submitter.id,
              email: submitter.email,
              name: submitter.name,
            }
          : undefined,
      },
    );

    await this.recordEvent(claim.id, "CLAIM_RECEIVED", {
      claimNumber,
      priority: claim.priority,
      documentPaths: storedDocumentPaths,
      submittedBy: submitter,
    });

    // Dispatch to parallel agents asynchronously so API response is immediate.
    void (async () => {
      const dispatchTaskId = await this.createTask(
        claim.id,
        { stage: "DISPATCH_PARALLEL" },
        "CLAIMS_RECEIVER",
      );
      try {
        await this.dispatchParallelProcessing(claim as any, dispatchTaskId);
      } catch (err) {
        const message = (err as Error).message;
        logger.error("Background dispatch failed", {
          claimId: claim.id,
          error: message,
        });
        await this.log(claim.id, "ERROR", "Initial dispatch failed", {
          error: message,
        });
        await this.updateTaskStatus(
          dispatchTaskId,
          "FAILED",
          undefined,
          message,
        );
      }
    })();

    return claim;
  }

  private async validateWithAI(claimData: Partial<Claim>) {
    try {
      const text = await Promise.race([
        this.llm.generateText(
          `Validate this insurance claim and return JSON with: isValid (bool), priority (LOW/NORMAL/HIGH/URGENT), notes (string), missingFields (array).
Claim: ${JSON.stringify(claimData)}`,
          { maxTokens: 500 },
        ),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("AI validation timeout")), 2500),
        ),
      ]);

      const jsonPayload = extractJsonObject(text);
      return jsonPayload
        ? JSON.parse(jsonPayload)
        : { isValid: true, priority: "NORMAL", notes: "" };
    } catch (err: any) {
      logger.warn("AI validation skipped", {
        error: err?.message,
      });
      return {
        isValid: true,
        priority: claimData.priority || "NORMAL",
        notes: "Validation skipped",
      };
    }
  }

  private async dispatchParallelProcessing(
    claim: Claim,
    dispatchTaskId?: string,
  ) {
    logger.info(
      `Dispatching parallel processing for claim ${claim.claimNumber}`,
    );

    if (dispatchTaskId) {
      await this.updateTaskStatus(dispatchTaskId, "RUNNING");
    }

    await this.prisma.claim.update({
      where: { id: claim.id },
      data: { status: "OCR_PROCESSING" },
    });

    await this.log(
      claim.id,
      "INFO",
      "Dispatching to parallel agents: OCR, ICD, Verification, Fraud",
    );
    await this.recordEvent(claim.id, "PARALLEL_DISPATCH", {
      agents: PARALLEL_AGENTS,
    });

    // Create tasks for all parallel agents
    const taskPayloads: Record<AgentName, unknown> = {
      CLAIMS_RECEIVER: {},
      OCR_PROCESSOR: {
        claimId: claim.id,
        documentPath: claim.documentPath,
        claimData: claim,
      },
      ICD_CONVERTER: {
        claimId: claim.id,
        diagnosis: claim.diagnosis,
        treatmentDetails: claim.treatmentDetails,
      },
      CUSTOMER_VERIFICATION: {
        claimId: claim.id,
        patientId: claim.patientId,
        insuranceId: claim.insuranceId,
      },
      FRAUD_DETECTION: { claimId: claim.id, claimData: claim },
      PAYMENT_GENERATOR: {},
    };

    // Send to parallel agents (fire and forget with response tracking)
    const sendPromises = PARALLEL_AGENTS.map(async (agentName) => {
      const taskId = await this.createTask(
        claim.id,
        taskPayloads[agentName],
        agentName,
      );
      try {
        const payload = taskPayloads[agentName];
        const payloadObject =
          payload && typeof payload === "object"
            ? (payload as Record<string, unknown>)
            : {};

        await this.a2aClient.send(agentName, "TASK_REQUEST", claim.id, {
          ...payloadObject,
          taskId,
        });
        await this.log(claim.id, "INFO", `Task dispatched to ${agentName}`, {
          taskId,
        });
      } catch (err: any) {
        await this.log(
          claim.id,
          "ERROR",
          `Failed to dispatch to ${agentName}`,
          { error: err.message },
        );
        await this.updateTaskStatus(taskId, "FAILED", undefined, err.message);
      }
    });

    const settled = await Promise.allSettled(sendPromises);
    const failedDispatches = settled.filter(
      (result) => result.status === "rejected",
    );

    if (dispatchTaskId) {
      if (failedDispatches.length > 0) {
        await this.updateTaskStatus(
          dispatchTaskId,
          "FAILED",
          {
            dispatchedAgents: PARALLEL_AGENTS.length - failedDispatches.length,
            failedAgents: failedDispatches.length,
          },
          `${failedDispatches.length} parallel dispatch(es) failed`,
        );
      } else {
        await this.updateTaskStatus(dispatchTaskId, "COMPLETED", {
          dispatchedAgents: PARALLEL_AGENTS,
        });
      }
    }
  }

  private async finalizeClaimProcessing(claimId: string, paymentData: unknown) {
    await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: "COMPLETED",
        paymentData: JSON.stringify(paymentData ?? {}),
      },
    });

    await this.log(
      claimId,
      "INFO",
      "✁EClaim processing completed successfully",
      paymentData,
    );
    await this.recordEvent(claimId, "CLAIM_COMPLETED", paymentData);
  }
}

const agent = new ClaimsReceiverAgent();
agent.start();
