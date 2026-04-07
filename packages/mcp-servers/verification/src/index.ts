/**
 * Mock MCP (Model Context Protocol) server for customer verification.
 * Implements JSON-RPC 2.0 over HTTP POST /mcp
 *
 * Tools exposed:
 *   verify_patient(patientId)         → patient identity check
 *   check_insurance_policy(insuranceId) → policy validity + coverage details
 *
 * 5 sample customers are pre-loaded (PAT-001 … PAT-005).
 * PAT-004 has an expired policy — useful for testing the failure path.
 *
 * Usage: PORT=5004 node dist/index.js   (default port: 5004)
 */

import express, { Request, Response } from "express";

const PORT = parseInt(process.env.PORT ?? "5004");

// ─── DATA MODEL ──────────────────────────────────────────────────────────────

interface Customer {
  patientId: string;
  name: string;
  dob: string;
  insuranceId: string;
  planName: string;
  policyActive: boolean;
  deductible: number;
  deductibleMet: number;
  outOfPocketMax: number;
  outOfPocketMet: number;
  coveragePercent: number;
}

// ─── 5 SAMPLE CUSTOMERS ──────────────────────────────────────────────────────

const CUSTOMERS: Customer[] = [
  {
    patientId: "PAT-001",
    name: "John Smith",
    dob: "1985-03-15",
    insuranceId: "INS-BLUE-7823",
    planName: "Blue Shield PPO Gold",
    policyActive: true,
    deductible: 1500,
    deductibleMet: 750,
    outOfPocketMax: 5000,
    outOfPocketMet: 1200,
    coveragePercent: 80,
  },
  {
    patientId: "PAT-002",
    name: "Maria Garcia",
    dob: "1992-07-22",
    insuranceId: "INS-AETNA-4512",
    planName: "Aetna HMO Silver",
    policyActive: true,
    deductible: 2000,
    deductibleMet: 300,
    outOfPocketMax: 6000,
    outOfPocketMet: 450,
    coveragePercent: 70,
  },
  {
    patientId: "PAT-003",
    name: "Robert Chen",
    dob: "1978-11-04",
    insuranceId: "INS-UNITED-9921",
    planName: "UnitedHealth Choice Plus",
    policyActive: true,
    deductible: 1000,
    deductibleMet: 1000, // fully met
    outOfPocketMax: 4000,
    outOfPocketMet: 2100,
    coveragePercent: 85,
  },
  {
    patientId: "PAT-004",
    name: "Emily Johnson",
    dob: "1965-05-30",
    insuranceId: "INS-HUMANA-3344",
    planName: "Humana Gold Plus HMO",
    policyActive: false, // ← expired — triggers verification failure
    deductible: 2500,
    deductibleMet: 0,
    outOfPocketMax: 7500,
    outOfPocketMet: 0,
    coveragePercent: 75,
  },
  {
    patientId: "PAT-005",
    name: "David Kim",
    dob: "2000-09-18",
    insuranceId: "INS-CIGNA-5567",
    planName: "Cigna Connect 3000",
    policyActive: true,
    deductible: 3000,
    deductibleMet: 500,
    outOfPocketMax: 8000,
    outOfPocketMet: 800,
    coveragePercent: 80,
  },
];

const BY_PATIENT_ID = new Map<string, Customer>(
  CUSTOMERS.map((c) => [c.patientId, c]),
);
const BY_INSURANCE_ID = new Map<string, Customer>(
  CUSTOMERS.map((c) => [c.insuranceId, c]),
);

// ─── MCP TOOL DEFINITIONS ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "verify_patient",
    description: "Verify a patient's identity and retrieve basic demographics.",
    inputSchema: {
      type: "object",
      properties: {
        patientId: {
          type: "string",
          description: "Patient identifier (e.g. PAT-001).",
        },
      },
      required: ["patientId"],
    },
  },
  {
    name: "check_insurance_policy",
    description:
      "Check insurance policy validity and retrieve coverage details.",
    inputSchema: {
      type: "object",
      properties: {
        insuranceId: {
          type: "string",
          description: "Insurance policy identifier (e.g. INS-BLUE-7823).",
        },
      },
      required: ["insuranceId"],
    },
  },
];

// ─── TOOL HANDLERS ────────────────────────────────────────────────────────────

function handleVerifyPatient(args: Record<string, string>) {
  const customer = BY_PATIENT_ID.get(args.patientId ?? "");
  if (!customer) {
    return { found: false, patientMatch: false, patientId: args.patientId };
  }
  return {
    found: true,
    patientMatch: true,
    patientId: customer.patientId,
    name: customer.name,
    dob: customer.dob,
    insuranceId: customer.insuranceId,
  };
}

function handleCheckInsurancePolicy(args: Record<string, string>) {
  const customer = BY_INSURANCE_ID.get(args.insuranceId ?? "");
  if (!customer) {
    return { found: false, insuranceId: args.insuranceId, policyActive: false };
  }
  return {
    found: true,
    insuranceId: customer.insuranceId,
    planName: customer.planName,
    policyActive: customer.policyActive,
    deductible: customer.deductible,
    deductibleMet: customer.deductibleMet,
    outOfPocketMax: customer.outOfPocketMax,
    outOfPocketMet: customer.outOfPocketMet,
    coveragePercent: customer.coveragePercent,
  };
}

// ─── JSON-RPC HELPERS ─────────────────────────────────────────────────────────

type RpcId = string | number | null | undefined;

function rpcOk(id: RpcId, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: RpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

// ─── EXPRESS + MCP ENDPOINT ───────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Single MCP endpoint — handles all JSON-RPC methods
app.post("/mcp", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");

  const { method, params, id } = req.body as {
    jsonrpc: string;
    method: string;
    params?: Record<string, unknown>;
    id?: RpcId;
  };

  // ── MCP handshake ──────────────────────────────────────────────────────────
  if (method === "initialize") {
    return res.json(
      rpcOk(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "verification-mcp-server", version: "1.0.0" },
      }),
    );
  }

  // Notification — no response body required
  if (method === "notifications/initialized") {
    return res.status(202).end();
  }

  // ── Tools list ────────────────────────────────────────────────────────────
  if (method === "tools/list") {
    return res.json(rpcOk(id, { tools: TOOLS }));
  }

  // ── Tool call ─────────────────────────────────────────────────────────────
  if (method === "tools/call") {
    const toolName = params?.name as string | undefined;
    const toolArgs = (params?.arguments ?? {}) as Record<string, string>;

    let result: unknown;
    try {
      if (toolName === "verify_patient") {
        result = handleVerifyPatient(toolArgs);
      } else if (toolName === "check_insurance_policy") {
        result = handleCheckInsurancePolicy(toolArgs);
      } else {
        return res
          .status(400)
          .json(rpcError(id, -32601, `Unknown tool: ${toolName ?? "(none)"}`));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.json(rpcError(id, -32603, msg));
    }

    return res.json(
      rpcOk(id, { content: [{ type: "text", text: JSON.stringify(result) }] }),
    );
  }

  return res
    .status(400)
    .json(rpcError(id, -32601, `Method not found: ${method}`));
});

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "healthy",
    service: "verification-mcp-server",
    customers: CUSTOMERS.length,
    tools: TOOLS.map((t) => t.name),
  });
});

// ─── STARTUP ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(
    `[verification-mcp] MCP server running on http://localhost:${PORT}/mcp`,
  );
  console.log(
    `[verification-mcp] ${CUSTOMERS.length} sample customers loaded:`,
  );
  CUSTOMERS.forEach((c) => {
    const status = c.policyActive ? "ACTIVE " : "EXPIRED";
    console.log(
      `  ${c.patientId}  ${c.name.padEnd(18)} ${c.insuranceId}  [${status}]`,
    );
  });
});
