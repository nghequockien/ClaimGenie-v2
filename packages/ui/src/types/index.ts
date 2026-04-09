export type AgentName =
  | "CLAIMS_RECEIVER"
  | "OCR_PROCESSOR"
  | "ICD_CONVERTER"
  | "CUSTOMER_VERIFICATION"
  | "FRAUD_DETECTION"
  | "PAYMENT_GENERATOR";

export type ClaimStatus =
  | "RECEIVED"
  | "OCR_PROCESSING"
  | "OCR_COMPLETED"
  | "OCR_FAILED"
  | "ICD_CONVERTING"
  | "ICD_COMPLETED"
  | "ICD_FAILED"
  | "VERIFYING_CUSTOMER"
  | "CUSTOMER_VERIFIED"
  | "CUSTOMER_FAILED"
  | "FRAUD_CHECKING"
  | "FRAUD_CLEARED"
  | "FRAUD_FLAGGED"
  | "PAYMENT_GENERATING"
  | "PAYMENT_GENERATED"
  | "PAYMENT_FAILED"
  | "COMPLETED"
  | "FAILED";

export type TaskStatus =
  | "PENDING"
  | "RUNNING"
  | "WARNING"
  | "ALERT"
  | "COMPLETED"
  | "FAILED"
  | "RETRYING";
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface AgentTask {
  id: string;
  claimId: string;
  agentName: AgentName;
  status: TaskStatus;
  input?: unknown;
  output?: unknown;
  errorMsg?: string;
  retryCount: number;
  maxRetries: number;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  createdAt: string;
}

export interface ClaimLog {
  id: string;
  claimId: string;
  taskId?: string;
  agentName?: AgentName;
  level: LogLevel;
  message: string;
  details?: unknown;
  timestamp: string;
}

export interface ClaimEvent {
  id: string;
  claimId: string;
  eventType: string;
  fromAgent?: AgentName;
  toAgent?: AgentName;
  payload?: unknown;
  timestamp: string;
}

export interface IcdCode {
  code: string;
  description: string;
  category: string;
  billable: boolean;
  confidence: number;
}

export interface FraudFlag {
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  description: string;
  evidence?: string;
}

export interface CoverageDetails {
  planName: string;
  deductible: number;
  deductibleMet: number;
  outOfPocketMax: number;
  outOfPocketMet: number;
  coveragePercent: number;
}

export interface VerificationData {
  verified: boolean;
  patientMatch: boolean;
  insuranceValid: boolean;
  policyActive: boolean;
  coverageDetails?: CoverageDetails;
  verificationId?: string;
  verifiedAt?: string;
}

export interface PaymentData {
  paymentId: string;
  claimNumber: string;
  approvedAmount: number;
  deductibleApplied: number;
  coinsuranceAmount: number;
  copayAmount: number;
  netPayableAmount: number;
  currency: string;
  paymentMethod: string;
  scheduledPaymentDate: string;
  paymentStatus: "SCHEDULED" | "PENDING_REVIEW" | "ON_HOLD";
  eobReference: string;
  notes?: string;
  generatedAt: string;
}

export interface Claim {
  id: string;
  claimNumber: string;
  patientName: string;
  patientDob: string;
  patientId: string;
  insuranceId: string;
  providerId: string;
  providerName: string;
  dateOfService: string;
  diagnosis?: string;
  treatmentDetails?: string;
  totalAmount: number;
  currency: string;
  documentPath?: string;
  rawOcrText?: string;
  icdCodes?: IcdCode[];
  fraudScore?: number;
  fraudFlags?: FraudFlag[];
  paymentData?: PaymentData;
  verificationData?: VerificationData;
  status: ClaimStatus;
  priority: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  tasks?: AgentTask[];
  logs?: ClaimLog[];
  events?: ClaimEvent[];
}

export interface SystemMetric {
  agentName: AgentName;
  totalProcessed: number;
  totalFailed: number;
  avgDuration?: number;
  lastActiveAt?: string;
}

export interface MetricsResponse {
  agents: SystemMetric[];
  claimsByStatus: { status: ClaimStatus; _count: { status: number } }[];
}

export interface AgentHealthStatus {
  status: "healthy" | "unhealthy" | "unreachable";
  port: number;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
export const AGENT_META: Record<
  AgentName,
  { label: string; color: string; icon: string; description: string }
> = {
  CLAIMS_RECEIVER: {
    label: "Claims Receiver",
    color: "#6366f1",
    icon: "📋",
    description: "Entry point — receives & dispatches claims",
  },
  OCR_PROCESSOR: {
    label: "OCR Processor",
    color: "#0ea5e9",
    icon: "🔍",
    description: "Extracts text from claim documents",
  },
  ICD_CONVERTER: {
    label: "ICD Converter",
    color: "#10b981",
    icon: "🏥",
    description: "Converts diagnoses to ICD-10 codes via MCP",
  },
  CUSTOMER_VERIFICATION: {
    label: "Customer Verification",
    color: "#f59e0b",
    icon: "👤",
    description: "Verifies patient & insurance via MCP",
  },
  FRAUD_DETECTION: {
    label: "Fraud Detection",
    color: "#ef4444",
    icon: "🛡️",
    description: "Scores claim risk via MCP",
  },
  PAYMENT_GENERATOR: {
    label: "Payment Generator",
    color: "#8b5cf6",
    icon: "💳",
    description: "Computes payment & hands off to receiver",
  },
};

export const STATUS_COLOR: Record<ClaimStatus, string> = {
  RECEIVED: "text-slate-400 bg-slate-700/30",
  OCR_PROCESSING: "text-sky-400 bg-sky-500/10",
  OCR_COMPLETED: "text-sky-300 bg-sky-500/15",
  OCR_FAILED: "text-red-400 bg-red-500/10",
  ICD_CONVERTING: "text-emerald-400 bg-emerald-500/10",
  ICD_COMPLETED: "text-emerald-300 bg-emerald-500/15",
  ICD_FAILED: "text-red-400 bg-red-500/10",
  VERIFYING_CUSTOMER: "text-amber-400 bg-amber-500/10",
  CUSTOMER_VERIFIED: "text-amber-300 bg-amber-500/15",
  CUSTOMER_FAILED: "text-red-400 bg-red-500/10",
  FRAUD_CHECKING: "text-orange-400 bg-orange-500/10",
  FRAUD_CLEARED: "text-green-300 bg-green-500/15",
  FRAUD_FLAGGED: "text-red-400 bg-red-500/20",
  PAYMENT_GENERATING: "text-violet-400 bg-violet-500/10",
  PAYMENT_GENERATED: "text-violet-300 bg-violet-500/15",
  PAYMENT_FAILED: "text-red-400 bg-red-500/10",
  COMPLETED: "text-green-400 bg-green-500/15",
  FAILED: "text-red-400 bg-red-500/15",
};

export const PRIORITY_COLOR: Record<string, string> = {
  LOW: "text-slate-400 bg-slate-700/30",
  NORMAL: "text-blue-400 bg-blue-500/10",
  HIGH: "text-orange-400 bg-orange-500/10",
  URGENT: "text-red-400 bg-red-500/15",
};

// ─── LLM & AGENT CONFIGURATION ────────────────────────────────────────────────
export type LlmProvider = "anthropic" | "openai" | "azure-openai" | "gemini";

export interface LlmProviderInfo {
  id: LlmProvider;
  name: string;
  models: string[];
}

export interface AgentConfig {
  agentName: AgentName;
  provider: LlmProvider;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  agentCard: Record<string, any> | null; // Complete Agent Card metadata
  configurable: boolean;
  updatedAt?: string;
}

export interface AgentConfigResponse {
  [key: string]: AgentConfig;
}
