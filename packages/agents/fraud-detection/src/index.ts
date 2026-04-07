import {
  BaseAgent,
  A2AMessage,
  FraudFlag,
  createLogger,
  LlmClient,
  resolveAgentLlmConfig,
  extractJsonObject,
} from "@claimgenie/shared";

const PORT = parseInt(process.env.PORT || "4005");
const logger = createLogger("FRAUD_DETECTION");

const FRAUD_MCP_URL = process.env.FRAUD_MCP_URL || "http://localhost:5005/mcp";

interface FraudAnalysisResult {
  fraudScore: number; // 0-100 (100 = definitely fraud)
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  flags: FraudFlag[];
  cleared: boolean;
  analysisId: string;
  analyzedAt: string;
  modelConfidence: number;
}

class FraudDetectionAgent extends BaseAgent {
  private llm: LlmClient;

  constructor() {
    const llmConfig = resolveAgentLlmConfig(
      "FRAUD_DETECTION",
      process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
    );

    super(
      "FRAUD_DETECTION",
      {
        name: "FRAUD_DETECTION",
        model: llmConfig.model,
        maxRetries: 2,
      },
      PORT,
    );
    this.llm = new LlmClient(llmConfig);
  }

  protected async handleA2AMessage(message: A2AMessage): Promise<A2AMessage> {
    if (message.messageType !== "TASK_REQUEST") {
      return this.createReply(message, "PONG", {});
    }

    const payload = message.payload as any;
    const { taskId, claimId, claimData } = payload;

    logger.info(`Running fraud detection for claim ${claimId}`);

    try {
      const result = await this.processTask(claimId, taskId, { claimData });
      return this.createReply(message, "TASK_RESPONSE", {
        success: true,
        data: result,
      });
    } catch (err: any) {
      return this.createReply(message, "TASK_ERROR", {
        success: false,
        error: err.message,
      });
    }
  }

  protected async processTask(
    claimId: string,
    taskId: string,
    data: unknown,
  ): Promise<FraudAnalysisResult> {
    const { claimData } = data as any;

    await this.updateTaskStatus(taskId, "RUNNING");
    await this.log(
      claimId,
      "INFO",
      "Starting fraud detection analysis",
      {},
      taskId,
    );

    const startTime = Date.now();

    try {
      const fraudResult = await this.analyzeViaMcp(claimData, claimId, taskId);

      const duration = Date.now() - startTime;
      const newStatus = fraudResult.cleared ? "FRAUD_CLEARED" : "FRAUD_FLAGGED";

      await this.prisma.claim.update({
        where: { id: claimId },
        data: {
          fraudScore: fraudResult.fraudScore,
          fraudFlags: JSON.stringify(fraudResult.flags),
          status: newStatus,
        },
      });

      const taskStatus = !fraudResult.cleared
        ? "ALERT"
        : fraudResult.riskLevel === "MEDIUM"
          ? "WARNING"
          : "COMPLETED";
      const taskMessage = !fraudResult.cleared
        ? `High fraud risk (${fraudResult.riskLevel}, score ${fraudResult.fraudScore}/100)`
        : fraudResult.riskLevel === "MEDIUM"
          ? `Medium fraud risk (${fraudResult.fraudScore}/100) - continue with caution`
          : undefined;

      await this.updateTaskStatus(taskId, taskStatus, fraudResult, taskMessage);
      await this.updateMetrics(true, duration);

      const logLevel =
        fraudResult.riskLevel === "HIGH" || fraudResult.riskLevel === "CRITICAL"
          ? "WARN"
          : "INFO";

      await this.log(
        claimId,
        logLevel,
        `Fraud analysis: ${fraudResult.riskLevel} risk (score: ${fraudResult.fraudScore}/100)`,
        {
          flags: fraudResult.flags.length,
          cleared: fraudResult.cleared,
          duration,
        },
        taskId,
      );

      if (!fraudResult.cleared) {
        await this.log(
          claimId,
          "WARN",
          "🚨 Fraud flags detected - claim requires manual review",
          {
            flags: fraudResult.flags.map((f) => `${f.type}: ${f.description}`),
          },
          taskId,
        );
      }

      return fraudResult;
    } catch (err: any) {
      await this.updateTaskStatus(taskId, "FAILED", undefined, err.message);
      await this.updateMetrics(false);
      await this.log(
        claimId,
        "ERROR",
        "Fraud detection failed",
        { error: err.message },
        taskId,
      );
      throw err;
    }
  }

  private async analyzeViaMcp(
    claimData: any,
    claimId: string,
    taskId: string,
  ): Promise<FraudAnalysisResult> {
    await this.log(
      claimId,
      "INFO",
      "Calling fraud MCP service",
      { url: FRAUD_MCP_URL },
      taskId,
    );

    const fraudResult = await this.mcpToolCall<FraudAnalysisResult>(
      FRAUD_MCP_URL,
      "fraud_check_claim",
      { claim: claimData },
    );

    const providerHistory = claimData?.providerId
      ? await this.mcpToolCall<Record<string, unknown>>(
          FRAUD_MCP_URL,
          "check_provider_history",
          { providerId: claimData.providerId },
        )
      : null;

    return {
      ...fraudResult,
      flags: Array.isArray(fraudResult.flags) ? fraudResult.flags : [],
      modelConfidence: Number(fraudResult.modelConfidence ?? 0.8),
      analysisId: fraudResult.analysisId ?? `FA-MCP-${Date.now()}`,
      analyzedAt: fraudResult.analyzedAt ?? new Date().toISOString(),
      cleared:
        typeof fraudResult.cleared === "boolean"
          ? fraudResult.cleared
          : Number(fraudResult.fraudScore ?? 0) < 40,
      details: providerHistory ? { providerHistory } : undefined,
    } as FraudAnalysisResult;
  }

  private async mcpToolCall<T>(
    url: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `MCP server responded with HTTP ${response.status}: ${url}`,
      );
    }

    const data = (await response.json()) as {
      jsonrpc: string;
      id: number;
      result?: { content: Array<{ type: string; text: string }> };
      error?: { code: number; message: string };
    };

    if (data.error) {
      throw new Error(`MCP tool error [${toolName}]: ${data.error.message}`);
    }

    if (!data.result?.content?.[0]?.text) {
      throw new Error(`Empty response from MCP tool: ${toolName}`);
    }

    return JSON.parse(data.result.content[0].text) as T;
  }

  private async analyzeWithAI(claimData: any): Promise<FraudAnalysisResult> {
    const prompt = `You are an expert insurance fraud detection AI. Analyze this claim for fraud indicators.

Claim Data: ${JSON.stringify(claimData, null, 2)}

Check for:
1. Unusually high amounts for the diagnosis/treatment
2. Suspicious billing patterns
3. Duplicate or similar claims
4. Procedure-diagnosis mismatch
5. Provider anomalies

Return ONLY valid JSON (no markdown, no explanation):
{
  "fraudScore": <0-100>,
  "riskLevel": "<LOW|MEDIUM|HIGH|CRITICAL>",
  "flags": [
    { "type": "<flag type>", "severity": "<LOW|MEDIUM|HIGH>", "description": "<description>", "evidence": "<evidence>" }
  ],
  "cleared": <true if score < 40>,
  "analysisId": "FA-${Date.now()}",
  "analyzedAt": "${new Date().toISOString()}",
  "modelConfidence": <0.0-1.0>
}

Most legitimate claims score 0-30. Flag if > 40. Be realistic - most medical claims are legitimate.`;

    const text = await this.llm.generateText(prompt, { maxTokens: 1000 });

    const jsonPayload = extractJsonObject(text);

    if (!jsonPayload) {
      return {
        fraudScore: 10,
        riskLevel: "LOW",
        flags: [],
        cleared: true,
        analysisId: `FA-${Date.now()}`,
        analyzedAt: new Date().toISOString(),
        modelConfidence: 0.8,
      };
    }

    try {
      const parsed = JSON.parse(jsonPayload);
      // Ensure cleared is consistent with score
      parsed.cleared = parsed.fraudScore < 40;
      return parsed;
    } catch {
      return {
        fraudScore: 10,
        riskLevel: "LOW",
        flags: [],
        cleared: true,
        analysisId: `FA-${Date.now()}`,
        analyzedAt: new Date().toISOString(),
        modelConfidence: 0.7,
      };
    }
  }
}

const agent = new FraudDetectionAgent();
agent.start();
