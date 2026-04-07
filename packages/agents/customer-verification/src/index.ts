import {
  BaseAgent,
  A2AMessage,
  VerificationResult,
  createLogger,
  LlmClient,
  resolveAgentLlmConfig,
  extractJsonObject,
} from "@claimgenie/shared";

const PORT = parseInt(process.env.PORT || "4004");
const logger = createLogger("CUSTOMER_VERIFICATION");

const VERIFICATION_MCP_URL =
  process.env.VERIFICATION_MCP_URL || "http://localhost:5004/mcp";

class CustomerVerificationAgent extends BaseAgent {
  private llm: LlmClient;

  constructor() {
    const llmConfig = resolveAgentLlmConfig(
      "CUSTOMER_VERIFICATION",
      process.env.CLAUDE_MODEL || "claude-haiku-4-5",
    );

    super(
      "CUSTOMER_VERIFICATION",
      {
        name: "CUSTOMER_VERIFICATION",
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
    const { taskId, claimId, patientId, insuranceId } = payload;

    logger.info(`Verifying customer for claim ${claimId}`);

    try {
      const result = await this.processTask(claimId, taskId, {
        patientId,
        insuranceId,
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
  ): Promise<VerificationResult> {
    const { patientId, insuranceId } = data as any;

    await this.updateTaskStatus(taskId, "RUNNING");
    await this.log(
      claimId,
      "INFO",
      "Starting customer verification",
      { patientId, insuranceId },
      taskId,
    );

    const startTime = Date.now();

    try {
      const verificationResult = await this.verifyViaMcp(
        patientId,
        insuranceId,
        claimId,
        taskId,
      );

      const duration = Date.now() - startTime;

      if (!verificationResult.verified) {
        const failureReasons: string[] = [];
        if (!verificationResult.patientMatch) {
          failureReasons.push("patient information mismatch");
        }
        if (!verificationResult.insuranceValid) {
          failureReasons.push("insurance policy mismatch");
        }
        if (!verificationResult.policyActive) {
          failureReasons.push("insurance policy inactive");
        }

        const failureMessage =
          failureReasons.join("; ") || "Customer verification failed";

        await this.prisma.claim.update({
          where: { id: claimId },
          data: {
            verificationData: JSON.stringify(verificationResult),
            status: "CUSTOMER_FAILED",
          },
        });

        await this.updateTaskStatus(
          taskId,
          "FAILED",
          verificationResult,
          failureMessage,
        );
        await this.updateMetrics(false, duration);
        await this.log(
          claimId,
          "WARN",
          "Customer verification failed",
          {
            patientMatch: verificationResult.patientMatch,
            insuranceValid: verificationResult.insuranceValid,
            policyActive: verificationResult.policyActive,
            failureMessage,
            duration,
          },
          taskId,
        );

        return verificationResult;
      }

      await this.prisma.claim.update({
        where: { id: claimId },
        data: {
          verificationData: JSON.stringify(verificationResult),
          status: "CUSTOMER_VERIFIED",
        },
      });

      await this.updateTaskStatus(taskId, "COMPLETED", verificationResult);
      await this.updateMetrics(true, duration);
      await this.log(
        claimId,
        "INFO",
        "Customer verification passed",
        {
          patientMatch: verificationResult.patientMatch,
          insuranceValid: verificationResult.insuranceValid,
          duration,
        },
        taskId,
      );

      return verificationResult;
    } catch (err: any) {
      await this.prisma.claim.update({
        where: { id: claimId },
        data: { status: "CUSTOMER_FAILED" },
      });
      await this.updateTaskStatus(taskId, "FAILED", undefined, err.message);
      await this.updateMetrics(false);
      await this.log(
        claimId,
        "ERROR",
        "Customer verification failed",
        { error: err.message },
        taskId,
      );
      throw err;
    }
  }

  private async verifyViaMcp(
    patientId: string,
    insuranceId: string,
    claimId: string,
    taskId: string,
  ): Promise<VerificationResult> {
    await this.log(
      claimId,
      "INFO",
      "Calling verification MCP service",
      { url: VERIFICATION_MCP_URL },
      taskId,
    );

    // Call verify_patient tool
    const patientData = await this.mcpToolCall<{
      found: boolean;
      patientMatch: boolean;
      insuranceId?: string;
      name?: string;
    }>(VERIFICATION_MCP_URL, "verify_patient", { patientId });

    if (!patientData.found) {
      throw new Error(
        `Patient not found in verification service: ${patientId}`,
      );
    }

    // Call check_insurance_policy tool
    const insuranceData = await this.mcpToolCall<{
      found: boolean;
      planName?: string;
      policyActive?: boolean;
      deductible?: number;
      deductibleMet?: number;
      outOfPocketMax?: number;
      outOfPocketMet?: number;
      coveragePercent?: number;
    }>(VERIFICATION_MCP_URL, "check_insurance_policy", { insuranceId });

    // Cross-check: the policy ID must belong to this patient
    const insuranceValid =
      insuranceData.found && patientData.insuranceId === insuranceId;
    const policyActive = insuranceData.policyActive ?? false;
    const verified = patientData.patientMatch && insuranceValid && policyActive;

    return {
      verified,
      patientMatch: patientData.patientMatch,
      insuranceValid,
      policyActive,
      coverageDetails: insuranceData.found
        ? {
            planName: insuranceData.planName ?? "Unknown Plan",
            deductible: insuranceData.deductible ?? 0,
            deductibleMet: insuranceData.deductibleMet ?? 0,
            outOfPocketMax: insuranceData.outOfPocketMax ?? 0,
            outOfPocketMet: insuranceData.outOfPocketMet ?? 0,
            coveragePercent: insuranceData.coveragePercent ?? 0,
          }
        : undefined,
      verificationId: `VER-MCP-${Date.now()}`,
      verifiedAt: new Date().toISOString(),
    };
  }

  /** Minimal MCP JSON-RPC 2.0 client — calls a single tool and returns the parsed result. */
  private async mcpToolCall<T>(
    url: string,
    toolName: string,
    args: Record<string, string>,
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

  private async simulateVerification(
    patientId: string,
    insuranceId: string,
  ): Promise<VerificationResult> {
    // Simulate verification with AI - realistic simulation for demo
    const text = await this.llm.generateText(
      `Simulate verification for patient ID: ${patientId}, insurance ID: ${insuranceId}.
Generate realistic insurance coverage data. Most claims should be valid (90% chance).
Return ONLY JSON (no markdown):
{
  "verified": true,
  "patientMatch": true,
  "insuranceValid": true,
  "policyActive": true,
  "coverageDetails": {
    "planName": "Blue Shield PPO Gold",
    "deductible": 1500,
    "deductibleMet": 750,
    "outOfPocketMax": 5000,
    "outOfPocketMet": 1200,
    "coveragePercent": 80
  },
  "verificationId": "VER-XXXXXXXX",
  "verifiedAt": "2024-11-15T10:30:00Z"
}`,
      { maxTokens: 800 },
    );

    const jsonPayload = extractJsonObject(text);
    if (!jsonPayload) {
      return {
        verified: true,
        patientMatch: true,
        insuranceValid: true,
        policyActive: true,
        coverageDetails: {
          planName: "Standard PPO",
          deductible: 2000,
          deductibleMet: 500,
          outOfPocketMax: 6000,
          outOfPocketMet: 800,
          coveragePercent: 80,
        },
        verificationId: `VER-${Date.now()}`,
        verifiedAt: new Date().toISOString(),
      };
    }
    return JSON.parse(jsonPayload);
  }
}

const agent = new CustomerVerificationAgent();
agent.start();
