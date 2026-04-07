import { v4 as uuidv4 } from "uuid";
import {
  BaseAgent,
  A2AMessage,
  PaymentData,
  AgentName,
  createLogger,
  LlmClient,
  resolveAgentLlmConfig,
  extractJsonObject,
} from "@claimgenie/shared";

const PORT = parseInt(process.env.PORT || "4006");
const logger = createLogger("PAYMENT_GENERATOR");

// Orchestrator polls for completion of parallel tasks and triggers payment
class PaymentGeneratorAgent extends BaseAgent {
  private llm: LlmClient;
  private pendingClaims: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    const llmConfig = resolveAgentLlmConfig(
      "PAYMENT_GENERATOR",
      process.env.CLAUDE_MODEL || "claude-haiku-4-5",
    );

    super(
      "PAYMENT_GENERATOR",
      {
        name: "PAYMENT_GENERATOR",
        model: llmConfig.model,
        maxRetries: 3,
      },
      PORT,
    );
    this.llm = new LlmClient(llmConfig);
    this.startOrchestrationLoop();
  }

  // Orchestration loop: polls for claims ready for payment generation
  private startOrchestrationLoop() {
    setInterval(async () => {
      try {
        await this.checkAndProcessReadyClaims();
      } catch (err: any) {
        logger.error("Orchestration loop error", { error: err.message });
      }
    }, 5000); // Every 5 seconds
  }

  private async checkAndProcessReadyClaims() {
    // Find claims where all parallel tasks completed successfully
    const claims = await this.prisma.claim.findMany({
      where: {
        status: {
          in: [
            "OCR_COMPLETED",
            "ICD_COMPLETED",
            "CUSTOMER_VERIFIED",
            "FRAUD_CLEARED",
          ],
        },
      },
      include: { tasks: true },
    });

    for (const claim of claims) {
      if (this.pendingClaims.has(claim.id)) continue;

      const parallelAgents: AgentName[] = [
        "OCR_PROCESSOR",
        "ICD_CONVERTER",
        "CUSTOMER_VERIFICATION",
        "FRAUD_DETECTION",
      ];
      const completedTasks = claim.tasks.filter(
        (t) =>
          parallelAgents.includes(t.agentName as AgentName) &&
          (t.status === "COMPLETED" || t.status === "WARNING"),
      );

      const failedTasks = claim.tasks.filter(
        (t) =>
          parallelAgents.includes(t.agentName as AgentName) &&
          (t.status === "FAILED" || t.status === "ALERT"),
      );

      if (failedTasks.length > 0) {
        logger.warn(
          `Claim ${claim.claimNumber} has failed tasks, skipping payment generation`,
        );
        continue;
      }

      if (completedTasks.length >= parallelAgents.length) {
        logger.info(
          `All parallel tasks complete for ${claim.claimNumber}, triggering payment`,
        );
        // Debounce to avoid double-processing
        const timer = setTimeout(async () => {
          this.pendingClaims.delete(claim.id);
          await this.triggerPaymentGeneration(claim.id);
        }, 2000);
        this.pendingClaims.set(claim.id, timer);
      }
    }
  }

  protected async handleA2AMessage(message: A2AMessage): Promise<A2AMessage> {
    if (message.messageType === "TASK_REQUEST") {
      const payload = message.payload as any;
      await this.triggerPaymentGeneration(payload.claimId);
      return this.createReply(message, "TASK_RESPONSE", { accepted: true });
    }
    return this.createReply(message, "PONG", {});
  }

  protected async processTask(
    claimId: string,
    taskId: string,
    _data: unknown,
  ): Promise<PaymentData> {
    return this.generatePayment(claimId, taskId);
  }

  private async triggerPaymentGeneration(claimId: string) {
    const existing = await this.prisma.agentTask.findFirst({
      where: {
        claimId,
        agentName: "PAYMENT_GENERATOR",
        status: { in: ["RUNNING", "COMPLETED"] },
      },
    });
    if (existing) return; // Already processing

    const taskId = await this.createTask(claimId);
    await this.generatePayment(claimId, taskId);
  }

  private async generatePayment(
    claimId: string,
    taskId: string,
  ): Promise<PaymentData> {
    await this.updateTaskStatus(taskId, "RUNNING");
    await this.log(
      claimId,
      "INFO",
      "Starting payment data generation",
      {},
      taskId,
    );

    const startTime = Date.now();

    try {
      // Fetch full claim with all results from parallel agents
      const claim = await this.prisma.claim.findUnique({
        where: { id: claimId },
        include: { tasks: true },
      });
      if (!claim) throw new Error(`Claim ${claimId} not found`);

      await this.prisma.claim.update({
        where: { id: claimId },
        data: { status: "PAYMENT_GENERATING" },
      });

      // Aggregate all parallel agent outputs
      const agentOutputs: Record<string, any> = {};
      for (const task of claim.tasks) {
        if (task.status === "COMPLETED" && task.output) {
          agentOutputs[task.agentName] = task.output;
        }
      }

      const paymentData = await this.computePayment(claim as any, agentOutputs);
      const duration = Date.now() - startTime;

      await this.prisma.claim.update({
        where: { id: claimId },
        data: {
          paymentData: JSON.stringify(paymentData),
          status: "PAYMENT_GENERATED",
        },
      });

      await this.updateTaskStatus(taskId, "COMPLETED", paymentData);
      await this.updateMetrics(true, duration);
      await this.log(
        claimId,
        "INFO",
        `Payment generated: $${paymentData.netPayableAmount.toFixed(2)}`,
        {
          paymentId: paymentData.paymentId,
          scheduledDate: paymentData.scheduledPaymentDate,
          duration,
        },
        taskId,
      );

      // Handoff back to Claims Receiver to finalize
      await this.log(
        claimId,
        "INFO",
        "🔄 Handing off to Claims Receiver for finalization",
      );
      await this.a2aClient.send("CLAIMS_RECEIVER", "HANDOFF", claimId, {
        claimId,
        fromAgent: "PAYMENT_GENERATOR",
        toAgent: "CLAIMS_RECEIVER",
        data: paymentData,
        finalStep: true,
      });

      return paymentData;
    } catch (err: any) {
      await this.prisma.claim.update({
        where: { id: claimId },
        data: { status: "PAYMENT_FAILED" },
      });
      await this.updateTaskStatus(taskId, "FAILED", undefined, err.message);
      await this.updateMetrics(false);
      await this.log(
        claimId,
        "ERROR",
        "Payment generation failed",
        { error: err.message },
        taskId,
      );
      throw err;
    }
  }

  private async computePayment(
    claim: any,
    agentOutputs: Record<string, any>,
  ): Promise<PaymentData> {
    const verificationData =
      typeof claim.verificationData === "string"
        ? JSON.parse(claim.verificationData || "{}")
        : (claim.verificationData as any);
    const coverage = verificationData?.coverageDetails;

    const prompt = `Generate insurance payment calculation for this claim.

Claim: ${JSON.stringify(
      {
        claimNumber: claim.claimNumber,
        totalAmount: claim.totalAmount,
        currency: claim.currency,
        icdCodes: claim.icdCodes,
        fraudScore: claim.fraudScore,
      },
      null,
      2,
    )}

Coverage: ${JSON.stringify(coverage || { coveragePercent: 80, deductible: 2000, deductibleMet: 500 }, null, 2)}

Calculate: approved amount, deductible applied, coinsurance, copay, net payable amount.
Schedule payment for 5 business days from now.

Return ONLY valid JSON:
{
  "paymentId": "PAY-${uuidv4().slice(0, 8).toUpperCase()}",
  "claimNumber": "${claim.claimNumber}",
  "approvedAmount": <number>,
  "deductibleApplied": <number>,
  "coinsuranceAmount": <number>,
  "copayAmount": <number>,
  "netPayableAmount": <number>,
  "currency": "${claim.currency}",
  "paymentMethod": "EFT",
  "bankRoutingNumber": "021000021",
  "bankAccountNumber": "XXXX-XXXX-${Math.floor(1000 + Math.random() * 9000)}",
  "scheduledPaymentDate": "<ISO date 5 business days from now>",
  "paymentStatus": "SCHEDULED",
  "eobReference": "EOB-${Date.now()}",
  "notes": "<calculation summary>",
  "generatedAt": "${new Date().toISOString()}"
}`;

    try {
      const text = await this.llm.generateText(prompt, { maxTokens: 800 });
      const jsonPayload = extractJsonObject(text);
      if (jsonPayload) {
        return JSON.parse(jsonPayload);
      }
    } catch (err: any) {
      logger.warn("AI payment computation failed, using formula", {
        error: err.message,
      });
    }

    // Fallback calculation
    const coveragePercent = coverage?.coveragePercent ?? 80;
    const deductibleRemaining = Math.max(
      0,
      (coverage?.deductible ?? 2000) - (coverage?.deductibleMet ?? 0),
    );
    const afterDeductible = Math.max(
      0,
      claim.totalAmount - deductibleRemaining,
    );
    const coinsurance = afterDeductible * ((100 - coveragePercent) / 100);
    const netPayable = afterDeductible * (coveragePercent / 100);

    const schedDate = new Date();
    schedDate.setDate(schedDate.getDate() + 7);

    return {
      paymentId: `PAY-${uuidv4().slice(0, 8).toUpperCase()}`,
      claimNumber: claim.claimNumber,
      approvedAmount: claim.totalAmount,
      deductibleApplied: deductibleRemaining,
      coinsuranceAmount: coinsurance,
      copayAmount: 30,
      netPayableAmount: Math.max(0, netPayable - 30),
      currency: claim.currency || "USD",
      paymentMethod: "EFT",
      bankRoutingNumber: "021000021",
      bankAccountNumber: `XXXX-XXXX-${Math.floor(1000 + Math.random() * 9000)}`,
      scheduledPaymentDate: schedDate.toISOString().split("T")[0],
      paymentStatus: "SCHEDULED",
      eobReference: `EOB-${Date.now()}`,
      notes: `Coverage: ${coveragePercent}%, Deductible applied: $${deductibleRemaining.toFixed(2)}`,
      generatedAt: new Date().toISOString(),
    };
  }
}

const agent = new PaymentGeneratorAgent();
agent.start();
