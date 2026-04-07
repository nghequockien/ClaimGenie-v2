import {
  BaseAgent,
  A2AMessage,
  IcdCode,
  createLogger,
  LlmClient,
  resolveAgentLlmConfig,
  extractJsonArray,
} from "@claimgenie/shared";

const PORT = parseInt(process.env.PORT || "4003");
const logger = createLogger("ICD_CONVERTER");

// MCP Service config for external ICD lookup
const ICD_MCP_URL = process.env.ICD_MCP_URL || "http://localhost:5003/mcp";

class IcdConverterAgent extends BaseAgent {
  private llm: LlmClient;

  constructor() {
    const llmConfig = resolveAgentLlmConfig(
      "ICD_CONVERTER",
      process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
    );

    super(
      "ICD_CONVERTER",
      {
        name: "ICD_CONVERTER",
        model: llmConfig.model,
        maxRetries: 3,
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
    const { taskId, claimId, diagnosis, treatmentDetails } = payload;

    logger.info(`Converting ICD codes for claim ${claimId}`);

    try {
      const result = await this.processTask(claimId, taskId, {
        diagnosis,
        treatmentDetails,
      });
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
  ): Promise<IcdCode[]> {
    const { diagnosis, treatmentDetails } = data as any;

    await this.updateTaskStatus(taskId, "RUNNING");
    await this.log(
      claimId,
      "INFO",
      "Starting ICD-10 code conversion",
      { diagnosis },
      taskId,
    );

    const startTime = Date.now();

    try {
      const icdCodes = await this.convertViaMcp(
        diagnosis,
        treatmentDetails,
        claimId,
        taskId,
      );

      const duration = Date.now() - startTime;

      await this.prisma.claim.update({
        where: { id: claimId },
        data: {
          icdCodes: JSON.stringify(icdCodes),
          status: "ICD_COMPLETED",
        },
      });

      await this.updateTaskStatus(taskId, "COMPLETED", icdCodes);
      await this.updateMetrics(true, duration);
      await this.log(
        claimId,
        "INFO",
        `ICD conversion complete: ${icdCodes.length} codes found`,
        {
          codes: icdCodes.map((c) => c.code),
          duration,
        },
        taskId,
      );

      return icdCodes;
    } catch (err: any) {
      await this.prisma.claim.update({
        where: { id: claimId },
        data: { status: "ICD_FAILED" },
      });
      await this.updateTaskStatus(taskId, "FAILED", undefined, err.message);
      await this.updateMetrics(false);
      await this.log(
        claimId,
        "ERROR",
        "ICD conversion failed",
        { error: err.message },
        taskId,
      );
      throw err;
    }
  }

  private async convertViaMcp(
    diagnosis: string,
    treatmentDetails: string,
    claimId: string,
    taskId: string,
  ): Promise<IcdCode[]> {
    await this.log(
      claimId,
      "INFO",
      "Calling ICD MCP service",
      { url: ICD_MCP_URL },
      taskId,
    );

    return this.mcpToolCall<IcdCode[]>(ICD_MCP_URL, "icd_lookup", {
      diagnosis,
      treatmentDetails,
      maxResults: 5,
    });
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

  private async convertWithAI(
    diagnosis: string,
    treatmentDetails: string,
  ): Promise<IcdCode[]> {
    const text = await this.llm.generateText(
      `Convert to ICD-10 codes. Diagnosis: "${diagnosis}". Treatment: "${treatmentDetails}".
Return ONLY a JSON array (no markdown): [{ "code": "X00.0", "description": "...", "category": "...", "billable": true, "confidence": 0.95 }]
Include primary diagnosis code and relevant procedure codes.`,
      { maxTokens: 1500 },
    );

    const jsonPayload = extractJsonArray(text);
    if (!jsonPayload) {
      // Generate sensible defaults
      return [
        {
          code: "Z00.00",
          description: "Encounter for general adult medical examination",
          category: "Z00-Z13",
          billable: true,
          confidence: 0.5,
        },
      ];
    }

    try {
      return JSON.parse(jsonPayload);
    } catch {
      return [];
    }
  }
}

const agent = new IcdConverterAgent();
agent.start();
