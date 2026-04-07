/**
 * Mock MCP (Model Context Protocol) server for fraud detection.
 * Implements JSON-RPC 2.0 over HTTP POST /mcp.
 *
 * Tools exposed:
 *   fraud_check_claim(claim)         → heuristic fraud analysis for a claim
 *   check_provider_history(providerId) → provider risk and billing history
 *
 * Usage: PORT=5005 node dist/index.js   (default port: 5005)
 */

import express, { Request, Response } from "express";

const PORT = parseInt(process.env.PORT ?? "5005");

interface ProviderHistory {
  providerId: string;
  providerName: string;
  specialty: string;
  avgClaimAmount: number;
  monthlyClaimVolume: number;
  priorFraudCases: number;
  watchlist: boolean;
  anomalyScore: number;
  notes: string[];
}

interface ClaimInput {
  claimNumber?: string;
  patientId?: string;
  providerId?: string;
  diagnosis?: string;
  treatmentDetails?: string;
  totalAmount?: number | string;
  dateOfService?: string;
}

type RpcId = string | number | null | undefined;

const PROVIDERS: ProviderHistory[] = [
  {
    providerId: "PROV-HOSP-001",
    providerName: "Metro General Hospital",
    specialty: "General Surgery",
    avgClaimAmount: 14200,
    monthlyClaimVolume: 180,
    priorFraudCases: 0,
    watchlist: false,
    anomalyScore: 12,
    notes: ["Stable billing pattern", "No prior fraud actions"],
  },
  {
    providerId: "PROV-CLINIC-042",
    providerName: "Riverside Family Clinic",
    specialty: "Primary Care",
    avgClaimAmount: 780,
    monthlyClaimVolume: 340,
    priorFraudCases: 0,
    watchlist: false,
    anomalyScore: 9,
    notes: ["Low-value routine claims", "Consistent utilization"],
  },
  {
    providerId: "PROV-ORTHO-007",
    providerName: "Advanced Orthopedics Center",
    specialty: "Orthopedics",
    avgClaimAmount: 6100,
    monthlyClaimVolume: 125,
    priorFraudCases: 1,
    watchlist: false,
    anomalyScore: 33,
    notes: ["One historical overbilling adjustment"],
  },
  {
    providerId: "PROV-CARD-015",
    providerName: "Heart & Vascular Institute",
    specialty: "Cardiology",
    avgClaimAmount: 29400,
    monthlyClaimVolume: 95,
    priorFraudCases: 0,
    watchlist: false,
    anomalyScore: 18,
    notes: ["High-cost specialty but consistent patterns"],
  },
  {
    providerId: "PROV-SURG-044",
    providerName: "Regional Surgical Group",
    specialty: "Surgery",
    avgClaimAmount: 12800,
    monthlyClaimVolume: 150,
    priorFraudCases: 3,
    watchlist: true,
    anomalyScore: 74,
    notes: [
      "Provider is on watchlist for atypical billing spikes",
      "Multiple prior fraud investigations",
    ],
  },
];

const PREVIOUS_CLAIMS = [
  {
    providerId: "PROV-SURG-044",
    patientId: "PAT-102345",
    dateOfService: "2024-10-28",
    totalAmount: 9800,
  },
  {
    providerId: "PROV-ORTHO-007",
    patientId: "PAT-100891",
    dateOfService: "2024-11-08",
    totalAmount: 3200,
  },
];

const BY_PROVIDER_ID = new Map(
  PROVIDERS.map((provider) => [provider.providerId, provider]),
);

const TOOLS = [
  {
    name: "fraud_check_claim",
    description: "Analyze a claim for billing anomalies and fraud indicators.",
    inputSchema: {
      type: "object",
      properties: {
        claim: {
          type: "object",
          description: "Claim payload to inspect for fraud risk.",
        },
      },
      required: ["claim"],
    },
  },
  {
    name: "check_provider_history",
    description: "Retrieve provider fraud risk history and billing anomalies.",
    inputSchema: {
      type: "object",
      properties: {
        providerId: {
          type: "string",
          description: "Provider identifier (e.g. PROV-SURG-044).",
        },
      },
      required: ["providerId"],
    },
  },
];

function rpcOk(id: RpcId, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: RpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toNumber(value: number | string | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimateExpectedAmount(claim: ClaimInput): number {
  const diagnosis =
    `${claim.diagnosis ?? ""} ${claim.treatmentDetails ?? ""}`.toLowerCase();

  if (diagnosis.includes("appendectomy")) return 22000;
  if (diagnosis.includes("myocardial") || diagnosis.includes("stent"))
    return 90000;
  if (diagnosis.includes("hernia")) return 11000;
  if (diagnosis.includes("fracture")) return 4500;
  if (diagnosis.includes("psoriasis")) return 5500;
  if (diagnosis.includes("diabetes")) return 1200;
  if (diagnosis.includes("asthma")) return 2200;
  return 5000;
}

function handleProviderHistory(args: Record<string, string>) {
  const provider = BY_PROVIDER_ID.get(args.providerId ?? "");
  if (!provider) {
    return {
      found: false,
      providerId: args.providerId,
      watchlist: false,
      priorFraudCases: 0,
      anomalyScore: 0,
      notes: ["No provider history found"],
    };
  }

  return {
    found: true,
    ...provider,
  };
}

function handleFraudCheckClaim(args: { claim?: ClaimInput }) {
  const claim = args.claim ?? {};
  const provider = claim.providerId
    ? BY_PROVIDER_ID.get(claim.providerId)
    : undefined;
  const amount = toNumber(claim.totalAmount);
  const expectedAmount = estimateExpectedAmount(claim);

  const flags: Array<{
    type: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    description: string;
    evidence: string;
  }> = [];

  let score = provider?.anomalyScore ?? 8;

  if (provider?.watchlist) {
    score += 30;
    flags.push({
      type: "PROVIDER_WATCHLIST",
      severity: "HIGH",
      description: "Provider appears on internal watchlist.",
      evidence: `${provider.providerId} has ${provider.priorFraudCases} prior fraud cases.`,
    });
  }

  if (amount > expectedAmount * 1.6) {
    score += 22;
    flags.push({
      type: "HIGH_BILLING_AMOUNT",
      severity: "HIGH",
      description: "Claim amount is significantly above expected range.",
      evidence: `Amount ${amount} vs expected ${expectedAmount}.`,
    });
  } else if (amount > expectedAmount * 1.2) {
    score += 10;
    flags.push({
      type: "ABOVE_AVERAGE_BILLING",
      severity: "MEDIUM",
      description: "Claim amount is moderately above expected range.",
      evidence: `Amount ${amount} vs expected ${expectedAmount}.`,
    });
  }

  const duplicate = PREVIOUS_CLAIMS.find(
    (entry) =>
      entry.providerId === claim.providerId &&
      entry.patientId === claim.patientId &&
      entry.dateOfService === claim.dateOfService,
  );

  if (duplicate) {
    score += 28;
    flags.push({
      type: "POSSIBLE_DUPLICATE_CLAIM",
      severity: "HIGH",
      description:
        "Potential duplicate claim for same provider, patient, and service date.",
      evidence: `Prior billed amount ${duplicate.totalAmount} on ${duplicate.dateOfService}.`,
    });
  }

  const diagnosisText =
    `${claim.diagnosis ?? ""} ${claim.treatmentDetails ?? ""}`.toLowerCase();
  if (diagnosisText.includes("diabetes") && amount > 5000) {
    score += 12;
    flags.push({
      type: "DIAGNOSIS_AMOUNT_MISMATCH",
      severity: "MEDIUM",
      description: "Routine diagnosis paired with atypically high amount.",
      evidence: `Diabetes-related claim billed at ${amount}.`,
    });
  }

  score = Math.max(0, Math.min(100, score));

  let riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "LOW";
  if (score >= 75) riskLevel = "CRITICAL";
  else if (score >= 55) riskLevel = "HIGH";
  else if (score >= 30) riskLevel = "MEDIUM";

  return {
    fraudScore: score,
    riskLevel,
    flags,
    cleared: score < 40,
    analysisId: `FA-${Date.now()}`,
    analyzedAt: new Date().toISOString(),
    modelConfidence: provider ? 0.91 : 0.72,
    providerRisk: provider
      ? {
          providerId: provider.providerId,
          watchlist: provider.watchlist,
          priorFraudCases: provider.priorFraudCases,
          anomalyScore: provider.anomalyScore,
        }
      : null,
  };
}

const app = express();
app.use(express.json());

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
        serverInfo: { name: "fraud-mcp-server", version: "1.0.0" },
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
      if (toolName === "fraud_check_claim") {
        return res.json(
          rpcOk(id, {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  handleFraudCheckClaim(toolArgs as { claim?: ClaimInput }),
                ),
              },
            ],
          }),
        );
      }

      if (toolName === "check_provider_history") {
        return res.json(
          rpcOk(id, {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  handleProviderHistory(toolArgs as Record<string, string>),
                ),
              },
            ],
          }),
        );
      }

      return res
        .status(400)
        .json(rpcError(id, -32601, `Unknown tool: ${toolName ?? "(none)"}`));
    } catch (err: unknown) {
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
    service: "fraud-mcp-server",
    providers: PROVIDERS.length,
    tools: TOOLS.map((tool) => tool.name),
  });
});

app.listen(PORT, () => {
  console.log(`[fraud-mcp] MCP server running on http://localhost:${PORT}/mcp`);
  console.log(`[fraud-mcp] ${PROVIDERS.length} provider profiles loaded`);
  PROVIDERS.forEach((provider) => {
    console.log(
      `  ${provider.providerId}  ${provider.providerName.padEnd(28)} watchlist=${provider.watchlist ? "yes" : "no"}`,
    );
  });
});
