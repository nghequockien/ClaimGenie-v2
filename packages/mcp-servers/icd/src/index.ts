import express, { Request, Response } from "express";

const PORT = parseInt(process.env.PORT ?? "5003", 10);

type RpcId = string | number | null | undefined;

type IcdEntry = {
  code: string;
  description: string;
  category: string;
  billable: boolean;
};

type LookupInput = {
  diagnosis?: string;
  treatmentDetails?: string;
  query?: string;
  maxResults?: number;
};

const ICD_CATALOG: IcdEntry[] = [
  {
    code: "I21.09",
    description:
      "ST elevation (STEMI) myocardial infarction involving other coronary artery of anterior wall",
    category: "Diseases of the circulatory system",
    billable: true,
  },
  {
    code: "I21.3",
    description:
      "ST elevation (STEMI) myocardial infarction of unspecified site",
    category: "Diseases of the circulatory system",
    billable: true,
  },
  {
    code: "K35.80",
    description: "Unspecified acute appendicitis",
    category: "Diseases of the digestive system",
    billable: true,
  },
  {
    code: "K40.90",
    description:
      "Unilateral inguinal hernia, without obstruction or gangrene, not specified as recurrent",
    category: "Diseases of the digestive system",
    billable: true,
  },
  {
    code: "S72.001A",
    description:
      "Fracture of unspecified part of neck of right femur, initial encounter for closed fracture",
    category:
      "Injury, poisoning and certain other consequences of external causes",
    billable: true,
  },
  {
    code: "J45.909",
    description: "Unspecified asthma, uncomplicated",
    category: "Diseases of the respiratory system",
    billable: true,
  },
  {
    code: "E11.9",
    description: "Type 2 diabetes mellitus without complications",
    category: "Endocrine, nutritional and metabolic diseases",
    billable: true,
  },
  {
    code: "L40.9",
    description: "Psoriasis, unspecified",
    category: "Diseases of the skin and subcutaneous tissue",
    billable: true,
  },
  {
    code: "R07.9",
    description: "Chest pain, unspecified",
    category: "Symptoms, signs and abnormal clinical and laboratory findings",
    billable: true,
  },
  {
    code: "Z00.00",
    description:
      "Encounter for general adult medical examination without abnormal findings",
    category:
      "Factors influencing health status and contact with health services",
    billable: true,
  },
];

const TOOLS = [
  {
    name: "icd_lookup",
    description:
      "Lookup ICD-10 diagnosis codes from a diagnosis or treatment description.",
    inputSchema: {
      type: "object",
      properties: {
        diagnosis: {
          type: "string",
          description: "Primary diagnosis text.",
        },
        treatmentDetails: {
          type: "string",
          description: "Additional treatment details.",
        },
        query: {
          type: "string",
          description: "Free text search fallback.",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of codes to return (default 5, max 10).",
        },
      },
    },
  },
];

function rpcOk(id: RpcId, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: RpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function scoreMatch(entry: IcdEntry, haystack: string): number {
  const text = `${entry.code} ${entry.description}`.toLowerCase();
  let score = 0;

  if (
    haystack.includes("myocard") ||
    haystack.includes("stemi") ||
    haystack.includes("heart attack")
  ) {
    if (text.includes("myocardial") || text.includes("stemi")) score += 4;
  }
  if (haystack.includes("append")) {
    if (text.includes("appendicitis")) score += 4;
  }
  if (haystack.includes("hernia")) {
    if (text.includes("hernia")) score += 4;
  }
  if (
    haystack.includes("fracture") ||
    haystack.includes("femur") ||
    haystack.includes("hip")
  ) {
    if (text.includes("fracture") || text.includes("femur")) score += 4;
  }
  if (haystack.includes("asthma")) {
    if (text.includes("asthma")) score += 4;
  }
  if (haystack.includes("diabetes")) {
    if (text.includes("diabetes")) score += 4;
  }
  if (haystack.includes("psoriasis")) {
    if (text.includes("psoriasis")) score += 4;
  }
  if (haystack.includes("chest pain")) {
    if (text.includes("chest pain")) score += 4;
  }

  const words = haystack
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);

  for (const word of words) {
    if (text.includes(word)) score += 1;
  }

  return score;
}

function handleIcdLookup(args: LookupInput) {
  const lookupText =
    `${args.diagnosis ?? ""} ${args.treatmentDetails ?? ""} ${args.query ?? ""}`
      .trim()
      .toLowerCase();

  const limitRaw = Number(args.maxResults ?? 5);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(10, Math.trunc(limitRaw)))
    : 5;

  const ranked = ICD_CATALOG.map((entry) => ({
    entry,
    score: lookupText ? scoreMatch(entry, lookupText) : 0,
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry, score }) => ({
      ...entry,
      confidence: lookupText
        ? Number(Math.min(0.98, 0.45 + score * 0.08).toFixed(2))
        : 0.5,
    }));

  const hasSignal = ranked.some((item) => item.confidence > 0.55);
  if (!hasSignal) {
    return [
      {
        code: "Z00.00",
        description:
          "Encounter for general adult medical examination without abnormal findings",
        category:
          "Factors influencing health status and contact with health services",
        billable: true,
        confidence: 0.5,
      },
    ];
  }

  return ranked;
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
        serverInfo: { name: "icd-mcp-server", version: "1.0.0" },
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
    const toolArgs = (params?.arguments ?? {}) as LookupInput;

    try {
      if (toolName !== "icd_lookup") {
        return res
          .status(400)
          .json(rpcError(id, -32601, `Unknown tool: ${toolName ?? "(none)"}`));
      }

      const result = handleIcdLookup(toolArgs);
      return res.json(
        rpcOk(id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
        }),
      );
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
    service: "icd-mcp-server",
    tools: TOOLS.map((tool) => tool.name),
    catalogSize: ICD_CATALOG.length,
  });
});

app.listen(PORT, () => {
  console.log(`[icd-mcp] MCP server running on http://localhost:${PORT}/mcp`);
  console.log(`[icd-mcp] ${ICD_CATALOG.length} ICD entries loaded.`);
});
