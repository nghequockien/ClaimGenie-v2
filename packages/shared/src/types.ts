// ─── A2A PROTOCOL TYPES ──────────────────────────────────────────────────────
export interface A2AMessage {
  id: string;
  protocol: "A2A/1.0";
  timestamp: string;
  correlationId: string; // Claim ID
  fromAgent: AgentName;
  toAgent: AgentName | "BROADCAST";
  messageType: A2AMessageType;
  payload: unknown;
  replyTo?: string; // Message ID to reply to
  priority?: Priority;
  metadata?: Record<string, unknown>;
}

export type A2AMessageType =
  | "TASK_REQUEST"
  | "TASK_RESPONSE"
  | "TASK_ERROR"
  | "TASK_RETRY"
  | "HANDOFF"
  | "STATUS_UPDATE"
  | "PING"
  | "PONG";

export interface A2ATaskRequest {
  taskId: string;
  claimId: string;
  data: unknown;
}

export interface A2ATaskResponse {
  taskId: string;
  claimId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  duration?: number;
}

export interface A2AHandoff {
  taskId: string;
  claimId: string;
  fromAgent: AgentName;
  toAgent: AgentName;
  data: unknown;
  finalStep: boolean;
}

// ─── DOMAIN TYPES ─────────────────────────────────────────────────────────────
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

export type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type TaskStatus =
  | "PENDING"
  | "RUNNING"
  | "WARNING"
  | "ALERT"
  | "COMPLETED"
  | "FAILED"
  | "RETRYING";

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
  verificationData?: VerificationResult;
  submittedByUserId?: string;
  submittedByEmail?: string;
  submittedByName?: string;
  submittedByRole?: string;
  submittedByProvider?: string;
  status: ClaimStatus;
  priority: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
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

export interface VerificationResult {
  verified: boolean;
  patientMatch: boolean;
  insuranceValid: boolean;
  policyActive: boolean;
  coverageDetails?: {
    planName: string;
    deductible: number;
    deductibleMet: number;
    outOfPocketMax: number;
    outOfPocketMet: number;
    coveragePercent: number;
  };
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
  bankRoutingNumber?: string;
  bankAccountNumber?: string;
  scheduledPaymentDate: string;
  paymentStatus: "SCHEDULED" | "PENDING_REVIEW" | "ON_HOLD";
  eobReference: string;
  notes?: string;
  generatedAt: string;
}

export interface AgentConfig {
  name: AgentName;
  model?: string;
  maxRetries?: number;
  timeoutMs?: number;
  enabled?: boolean;
}

export interface ProcessingResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  agentName: AgentName;
  taskId: string;
  duration: number;
}

// ─── MCP SERVICE TYPES ────────────────────────────────────────────────────────
export interface McpServiceConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
}

export interface OcrResult {
  rawText: string;
  structuredData: {
    patientName?: string;
    patientId?: string;
    dateOfService?: string;
    diagnosis?: string;
    treatmentDetails?: string;
    totalAmount?: number;
    providerId?: string;
    providerName?: string;
  };
  confidence: number;
  pageCount: number;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
export const AGENT_PORTS: Record<AgentName, number> = {
  CLAIMS_RECEIVER: 4001,
  OCR_PROCESSOR: 4002,
  ICD_CONVERTER: 4003,
  CUSTOMER_VERIFICATION: 4004,
  FRAUD_DETECTION: 4005,
  PAYMENT_GENERATOR: 4006,
};

export const AGENT_COLORS: Record<AgentName, string> = {
  CLAIMS_RECEIVER: "#6366f1",
  OCR_PROCESSOR: "#0ea5e9",
  ICD_CONVERTER: "#10b981",
  CUSTOMER_VERIFICATION: "#f59e0b",
  FRAUD_DETECTION: "#ef4444",
  PAYMENT_GENERATOR: "#8b5cf6",
};

export const PARALLEL_AGENTS: AgentName[] = [
  "OCR_PROCESSOR",
  "ICD_CONVERTER",
  "CUSTOMER_VERIFICATION",
  "FRAUD_DETECTION",
];

export const STATUS_FLOW: Record<ClaimStatus, ClaimStatus | null> = {
  RECEIVED: "OCR_PROCESSING",
  OCR_PROCESSING: "OCR_COMPLETED",
  OCR_COMPLETED: "ICD_CONVERTING",
  OCR_FAILED: "FAILED",
  ICD_CONVERTING: "ICD_COMPLETED",
  ICD_COMPLETED: "VERIFYING_CUSTOMER",
  ICD_FAILED: "FAILED",
  VERIFYING_CUSTOMER: "CUSTOMER_VERIFIED",
  CUSTOMER_VERIFIED: "FRAUD_CHECKING",
  CUSTOMER_FAILED: "FAILED",
  FRAUD_CHECKING: "FRAUD_CLEARED",
  FRAUD_CLEARED: "PAYMENT_GENERATING",
  FRAUD_FLAGGED: "FAILED",
  PAYMENT_GENERATING: "PAYMENT_GENERATED",
  PAYMENT_GENERATED: "COMPLETED",
  PAYMENT_FAILED: "FAILED",
  COMPLETED: null,
  FAILED: null,
};
