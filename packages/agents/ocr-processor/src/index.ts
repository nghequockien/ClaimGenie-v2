import fs from "fs";
import path from "path";
import {
  BaseAgent,
  A2AMessage,
  OcrResult,
  createLogger,
  LlmClient,
  resolveAgentLlmConfig,
  extractJsonObject,
} from "@claimgenie/shared";

const PORT = parseInt(process.env.PORT || "4002");
const logger = createLogger("OCR_PROCESSOR");
const OCR_MCP_URL = process.env.OCR_MCP_URL || "http://localhost:5002/mcp";

class OcrProcessorAgent extends BaseAgent {
  private llm: LlmClient;

  constructor() {
    const llmConfig = resolveAgentLlmConfig(
      "OCR_PROCESSOR",
      process.env.CLAUDE_MODEL || "claude-opus-4-5",
    );

    super(
      "OCR_PROCESSOR",
      {
        name: "OCR_PROCESSOR",
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
    const { taskId, claimId, documentPath, claimData } = payload;

    logger.info(`Processing OCR for claim ${claimId}`);

    try {
      const result = await this.processTask(claimId, taskId, {
        documentPath,
        claimData,
      });
      return this.createReply(message, "TASK_RESPONSE", {
        success: true,
        data: result,
      });
    } catch (err: any) {
      logger.error("OCR processing failed", { error: err.message, claimId });
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
  ): Promise<OcrResult> {
    const { documentPath, claimData } = data as any;

    await this.updateTaskStatus(taskId, "RUNNING");
    await this.log(
      claimId,
      "INFO",
      "Starting OCR processing",
      { documentPath },
      taskId,
    );

    try {
      const startTime = Date.now();
      const ocrResult = await this.processViaMcp(claimData, claimId, taskId);

      const duration = Date.now() - startTime;

      // Update claim with OCR results
      await this.prisma.claim.update({
        where: { id: claimId },
        data: {
          rawOcrText: ocrResult.rawText,
          status: "OCR_COMPLETED",
        },
      });

      await this.updateTaskStatus(taskId, "COMPLETED", ocrResult);
      await this.updateMetrics(true, duration);
      await this.log(
        claimId,
        "INFO",
        "OCR processing completed",
        {
          confidence: ocrResult.confidence,
          textLength: ocrResult.rawText.length,
          duration,
        },
        taskId,
      );

      return ocrResult;
    } catch (err: any) {
      await this.prisma.claim.update({
        where: { id: claimId },
        data: { status: "OCR_FAILED" },
      });
      await this.updateTaskStatus(taskId, "FAILED", undefined, err.message);
      await this.updateMetrics(false);
      await this.log(
        claimId,
        "ERROR",
        "OCR processing failed",
        { error: err.message },
        taskId,
      );
      throw err;
    }
  }

  private async processViaMcp(
    claimData: any,
    claimId: string,
    taskId: string,
  ): Promise<OcrResult> {
    await this.log(
      claimId,
      "INFO",
      "Calling OCR MCP service",
      { url: OCR_MCP_URL },
      taskId,
    );

    const result = await this.mcpToolCall<OcrResult>(
      OCR_MCP_URL,
      "process_document",
      {
        claimData: claimData ?? {},
        documentType: "claim_form",
      },
    );

    return {
      rawText: result.rawText ?? "",
      structuredData: result.structuredData ?? {},
      confidence: Number(result.confidence ?? 0.85),
      pageCount: Number(result.pageCount ?? 1),
    };
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

  private async processDocumentWithVision(
    documentPath: string,
    claimData: any,
  ): Promise<OcrResult> {
    const fileBuffer = fs.readFileSync(documentPath);
    const base64Data = fileBuffer.toString("base64");
    const mimeType = this.detectMimeType(documentPath);

    const text = await this.llm.generateVisionText(
      `Extract all text and structured data from this insurance claim document. Return JSON with:
- rawText: full extracted text
- structuredData: { patientName, patientId, dateOfService, diagnosis, treatmentDetails, totalAmount, providerId, providerName }
- confidence: 0-1 confidence score
- pageCount: number of pages`,
      {
        imageBase64: base64Data,
        mimeType,
        maxTokens: 2000,
      },
    );

    const jsonPayload = extractJsonObject(text);
    const parsed = jsonPayload ? JSON.parse(jsonPayload) : {};

    return {
      rawText: parsed.rawText || text,
      structuredData: parsed.structuredData || {},
      confidence: parsed.confidence || 0.85,
      pageCount: parsed.pageCount || 1,
    };
  }

  private async extractFromClaimData(claimData: any): Promise<OcrResult> {
    // Use Claude to normalize and enrich the text data
    const text = await this.llm.generateText(
      `Convert this insurance claim JSON into structured medical claim text and extract key fields.
Input: ${JSON.stringify(claimData)}
Return JSON with rawText (formatted claim text), structuredData (normalized fields), confidence (0-1), pageCount (1).`,
      { maxTokens: 1000 },
    );

    const jsonPayload = extractJsonObject(text);
    const parsed = jsonPayload ? JSON.parse(jsonPayload) : {};

    return {
      rawText:
        parsed.rawText ||
        `Patient: ${claimData.patientName}\nDiagnosis: ${claimData.diagnosis}\nAmount: $${claimData.totalAmount}`,
      structuredData: parsed.structuredData || {
        patientName: claimData.patientName,
        patientId: claimData.patientId,
        dateOfService: claimData.dateOfService,
        diagnosis: claimData.diagnosis,
        treatmentDetails: claimData.treatmentDetails,
        totalAmount: claimData.totalAmount,
        providerId: claimData.providerId,
        providerName: claimData.providerName,
      },
      confidence: 0.95,
      pageCount: 1,
    };
  }

  private detectMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".pdf": "application/pdf",
    };
    return mimeMap[ext] || "image/jpeg";
  }
}

const agent = new OcrProcessorAgent();
agent.start();
