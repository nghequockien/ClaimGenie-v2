/**
 * Mock MCP (Model Context Protocol) server for OCR processing.
 * Implements JSON-RPC 2.0 over HTTP POST /mcp
 *
 * Tools exposed:
 *   process_document(claimData)      → extracts rawText + structuredData from claim fields
 *   extract_claim_fields(rawText)    → parses key claim fields out of free-form text
 *
 * Mimics the OcrResult shape that OcrProcessorAgent expects:
 *   { rawText, structuredData, confidence, pageCount }
 *
 * Usage: PORT=5002 node dist/index.js   (default port: 5002)
 */

import express, { Request, Response } from "express";

const PORT = parseInt(process.env.PORT ?? "5002", 10);

type RpcId = string | number | null | undefined;

// ─── TYPES matching shared OcrResult ─────────────────────────────────────────

interface StructuredData {
  patientName?: string;
  patientId?: string;
  dateOfService?: string;
  diagnosis?: string;
  treatmentDetails?: string;
  totalAmount?: number | string;
  providerId?: string;
  providerName?: string;
  [key: string]: unknown;
}

interface OcrResult {
  rawText: string;
  structuredData: StructuredData;
  confidence: number;
  pageCount: number;
}

interface ClaimInput {
  patientName?: string;
  patientId?: string;
  dateOfService?: string;
  diagnosis?: string;
  treatmentDetails?: string;
  totalAmount?: number | string;
  providerId?: string;
  providerName?: string;
  documentType?: string;
  [key: string]: unknown;
}

// ─── SAMPLE PROVIDER NAME LOOKUP ─────────────────────────────────────────────

const PROVIDER_NAMES: Record<string, string> = {
  "PROV-HOSP-001": "Metro General Hospital",
  "PROV-CLINIC-042": "Riverside Family Clinic",
  "PROV-ORTHO-007": "Advanced Orthopedics Center",
  "PROV-CARD-015": "Heart & Vascular Institute",
  "PROV-SURG-044": "Regional Surgical Group",
};

// ─── TOOL DEFINITIONS ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "process_document",
    description:
      "Extract structured claim data from a claim object or uploaded document metadata. Returns rawText, structuredData, confidence, and pageCount matching the OcrResult shape.",
    inputSchema: {
      type: "object",
      properties: {
        claimData: {
          type: "object",
          description: "Structured claim data object (JSON).",
        },
        documentType: {
          type: "string",
          description:
            "Optional hint: 'claim_form' | 'referral' | 'receipt' | 'lab_report'.",
          enum: ["claim_form", "referral", "receipt", "lab_report"],
        },
      },
      required: ["claimData"],
    },
  },
  {
    name: "extract_claim_fields",
    description:
      "Parse key claim fields from free-form OCR text. Returns a structuredData object with best-effort field extraction.",
    inputSchema: {
      type: "object",
      properties: {
        rawText: {
          type: "string",
          description: "Raw text extracted from a claim document.",
        },
      },
      required: ["rawText"],
    },
  },
];

// ─── JSON-RPC HELPERS ─────────────────────────────────────────────────────────

function rpcOk(id: RpcId, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: RpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

// ─── TOOL HANDLERS ────────────────────────────────────────────────────────────

function handleProcessDocument(args: {
  claimData?: ClaimInput;
  documentType?: string;
}): OcrResult {
  const claim = args.claimData ?? {};

  const providerName =
    claim.providerName ??
    (claim.providerId
      ? (PROVIDER_NAMES[claim.providerId] ?? claim.providerId)
      : "Unknown Provider");

  const dateStr = claim.dateOfService ?? new Date().toISOString().slice(0, 10);
  const amount =
    claim.totalAmount != null ? `$${claim.totalAmount}` : "Not specified";

  const rawText = [
    "INSURANCE CLAIM DOCUMENT",
    "═══════════════════════════════════════",
    `Document Type  : ${args.documentType ?? "claim_form"}`,
    `Date of Service: ${dateStr}`,
    "",
    "PATIENT INFORMATION",
    `  Name         : ${claim.patientName ?? "Unknown"}`,
    `  Patient ID   : ${claim.patientId ?? "N/A"}`,
    "",
    "PROVIDER INFORMATION",
    `  Provider     : ${providerName}`,
    `  Provider ID  : ${claim.providerId ?? "N/A"}`,
    "",
    "CLINICAL DETAILS",
    `  Diagnosis    : ${claim.diagnosis ?? "Not specified"}`,
    `  Treatment    : ${claim.treatmentDetails ?? "Not specified"}`,
    "",
    "BILLING",
    `  Total Amount : ${amount}`,
    "═══════════════════════════════════════",
    "END OF DOCUMENT",
  ].join("\n");

  const structuredData: StructuredData = {
    patientName: claim.patientName,
    patientId: claim.patientId,
    dateOfService: dateStr,
    diagnosis: claim.diagnosis,
    treatmentDetails: claim.treatmentDetails,
    totalAmount: claim.totalAmount,
    providerId: claim.providerId,
    providerName,
  };

  // Confidence is slightly lower for unknown providers or missing key fields
  const missingFields = [
    claim.patientName,
    claim.patientId,
    claim.diagnosis,
    claim.totalAmount,
  ].filter((v) => v == null).length;
  const confidence = Math.max(0.6, 0.98 - missingFields * 0.07);

  return {
    rawText,
    structuredData,
    confidence: Number(confidence.toFixed(2)),
    pageCount: 1,
  };
}

function handleExtractClaimFields(args: { rawText?: string }): StructuredData {
  const text = args.rawText ?? "";

  function parseField(patterns: RegExp[]): string | undefined {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]?.trim()) return match[1].trim();
    }
    return undefined;
  }

  const patientName = parseField([
    /patient\s*name\s*[:\-]\s*(.+)/i,
    /name\s*[:\-]\s*(.+)/i,
    /patient\s*[:\-]\s*(.+)/i,
  ]);

  const patientId = parseField([
    /patient\s*id\s*[:\-]\s*(\S+)/i,
    /member\s*id\s*[:\-]\s*(\S+)/i,
    /id\s*[:\-]\s*(PAT-\S+)/i,
  ]);

  const dateOfService = parseField([
    /date\s*of\s*service\s*[:\-]\s*(\d{4}-\d{2}-\d{2})/i,
    /service\s*date\s*[:\-]\s*(\d{4}-\d{2}-\d{2})/i,
    /dos\s*[:\-]\s*(\d{4}-\d{2}-\d{2})/i,
  ]);

  const diagnosis = parseField([
    /diagnosis\s*[:\-]\s*(.+)/i,
    /dx\s*[:\-]\s*(.+)/i,
  ]);

  const treatmentDetails = parseField([
    /treatment\s*[:\-]\s*(.+)/i,
    /procedure\s*[:\-]\s*(.+)/i,
    /service\s*[:\-]\s*(.+)/i,
  ]);

  const amountRaw = parseField([
    /total\s*amount\s*[:\-]\s*\$?([\d,\.]+)/i,
    /amount\s*[:\-]\s*\$?([\d,\.]+)/i,
    /billed\s*[:\-]\s*\$?([\d,\.]+)/i,
  ]);
  const totalAmount = amountRaw
    ? parseFloat(amountRaw.replace(/,/g, ""))
    : undefined;

  const providerId = parseField([
    /provider\s*id\s*[:\-]\s*(PROV-\S+)/i,
    /provider\s*[:\-]\s*(PROV-\S+)/i,
  ]);

  const providerName = parseField([
    /provider\s*[:\-]\s*([^(PROV).]+)/i,
    /facility\s*[:\-]\s*(.+)/i,
    /hospital\s*[:\-]\s*(.+)/i,
  ]);

  return {
    patientName,
    patientId,
    dateOfService,
    diagnosis,
    treatmentDetails,
    totalAmount: totalAmount ?? undefined,
    providerId,
    providerName,
  };
}

// ─── EXPRESS + MCP ENDPOINT ───────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/mcp", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");

  const { method, params, id } = req.body as {
    jsonrpc: string;
    method: string;
    params?: Record<string, unknown>;
    id?: RpcId;
  };

  if (method === "initialize") {
    return res.json(
      rpcOk(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "ocr-mcp-server", version: "1.0.0" },
      }),
    );
  }

  if (method === "notifications/initialized") {
    return res.status(202).end();
  }

  if (method === "tools/list") {
    return res.json(rpcOk(id, { tools: TOOLS }));
  }

  if (method === "tools/call") {
    const toolName = params?.name as string | undefined;
    const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;

    try {
      if (toolName === "process_document") {
        const result = handleProcessDocument(
          toolArgs as { claimData?: ClaimInput; documentType?: string },
        );
        return res.json(
          rpcOk(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
          }),
        );
      }

      if (toolName === "extract_claim_fields") {
        const result = handleExtractClaimFields(
          toolArgs as { rawText?: string },
        );
        return res.json(
          rpcOk(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
          }),
        );
      }

      return res
        .status(400)
        .json(rpcError(id, -32601, `Unknown tool: ${toolName ?? "(none)"}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.json(rpcError(id, -32603, message));
    }
  }

  return res
    .status(400)
    .json(rpcError(id, -32601, `Method not found: ${method}`));
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "healthy",
    service: "ocr-mcp-server",
    tools: TOOLS.map((t) => t.name),
    providerProfiles: Object.keys(PROVIDER_NAMES).length,
  });
});

// ─── STARTUP ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[ocr-mcp] MCP server running on http://localhost:${PORT}/mcp`);
  console.log(`[ocr-mcp] Tools: ${TOOLS.map((t) => t.name).join(", ")}`);
  console.log(
    `[ocr-mcp] ${Object.keys(PROVIDER_NAMES).length} provider profiles loaded`,
  );
});
