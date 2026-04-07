import crypto from "node:crypto";
import { promisify } from "node:util";
import { prismaClient as prisma, prismaReady } from "../src/prisma-client";

type AppUserDelegate = {
  findUnique: (args: {
    where: { email: string };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
  upsert: (args: {
    where: { email: string };
    update: {
      fullName: string;
      provider: string;
      providerUserId: string;
      passwordHash: string;
      role: string;
      isActive: boolean;
    };
    create: {
      email: string;
      fullName: string;
      provider: string;
      providerUserId: string;
      passwordHash: string;
      role: string;
      isActive: boolean;
      lastLoginAt: Date;
    };
  }) => Promise<unknown>;
};

const appUserStore = (prisma as unknown as { appUser: AppUserDelegate })
  .appUser;

const DEFAULT_ADMIN_EMAIL =
  process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() || "nghe@kien.digital";
const DEFAULT_ADMIN_PASSWORD =
  process.env.SEED_ADMIN_PASSWORD?.trim() || "12345678";
const DEFAULT_ADMIN_NAME =
  process.env.SEED_ADMIN_NAME?.trim() || "Micheal Nghe";

const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function seedDefaultAdminUser() {
  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);

  const existingUser = await appUserStore.findUnique({
    where: { email: DEFAULT_ADMIN_EMAIL },
    select: { id: true },
  });

  await appUserStore.upsert({
    where: { email: DEFAULT_ADMIN_EMAIL },
    update: {
      fullName: DEFAULT_ADMIN_NAME,
      provider: "local",
      providerUserId: DEFAULT_ADMIN_EMAIL,
      passwordHash,
      role: "ADMIN",
      isActive: true,
    },
    create: {
      email: DEFAULT_ADMIN_EMAIL,
      fullName: DEFAULT_ADMIN_NAME,
      provider: "local",
      providerUserId: DEFAULT_ADMIN_EMAIL,
      passwordHash,
      role: "ADMIN",
      isActive: true,
      lastLoginAt: new Date(),
    },
  });

  console.log(
    `✅ ${existingUser ? "Updated" : "Created"} default admin user: ${DEFAULT_ADMIN_EMAIL}`,
  );
}

// Helper: SQLite stores JSON as text; PostgreSQL uses native JSON.
// Prisma 7 with adapters handles this via the schema type (String vs Json),
// so we pass plain objects — the adapter serialises as needed.
const sampleClaims = [
  {
    claimNumber: "CLM-2024-001",
    patientName: "Sarah Johnson",
    patientDob: "1985-03-15",
    patientId: "PAT-100234",
    insuranceId: "INS-BLUE-789012",
    providerId: "PROV-HOSP-001",
    providerName: "Metro General Hospital",
    dateOfService: "2024-11-10",
    diagnosis: "Acute appendicitis with abscess",
    treatmentDetails:
      "Emergency appendectomy, 3-day hospital stay, post-op care",
    totalAmount: 18500.0,
    currency: "USD",
    status: "RECEIVED",
    priority: "HIGH",
    metadata: JSON.stringify({
      submittedBy: "provider_portal",
      channel: "electronic",
    }),
  },
  {
    claimNumber: "CLM-2024-002",
    patientName: "Michael Chen",
    patientDob: "1972-08-22",
    patientId: "PAT-100567",
    insuranceId: "INS-AETNA-456789",
    providerId: "PROV-CLINIC-042",
    providerName: "Riverside Family Clinic",
    dateOfService: "2024-11-12",
    diagnosis: "Type 2 diabetes mellitus, uncontrolled",
    treatmentDetails:
      "HbA1c testing, medication adjustment, dietary consultation",
    totalAmount: 850.0,
    currency: "USD",
    status: "RECEIVED",
    priority: "NORMAL",
    metadata: JSON.stringify({
      submittedBy: "provider_portal",
      channel: "electronic",
    }),
  },
  {
    claimNumber: "CLM-2024-003",
    patientName: "Emily Rodriguez",
    patientDob: "1995-12-01",
    patientId: "PAT-100891",
    insuranceId: "INS-CIGNA-234567",
    providerId: "PROV-ORTHO-007",
    providerName: "Advanced Orthopedics Center",
    dateOfService: "2024-11-08",
    diagnosis: "Fracture of right distal radius",
    treatmentDetails: "Closed reduction, cast application, 2 follow-up X-rays",
    totalAmount: 3200.0,
    currency: "USD",
    status: "RECEIVED",
    priority: "NORMAL",
    metadata: JSON.stringify({ submittedBy: "fax", channel: "paper" }),
  },
  {
    claimNumber: "CLM-2024-004",
    patientName: "Robert Thompson",
    patientDob: "1958-06-30",
    patientId: "PAT-101124",
    insuranceId: "INS-UNITED-345678",
    providerId: "PROV-CARD-015",
    providerName: "Heart & Vascular Institute",
    dateOfService: "2024-11-05",
    diagnosis: "Acute myocardial infarction, anterior wall",
    treatmentDetails:
      "Emergency PCI, stent placement, 5-day ICU stay, cardiac rehab referral",
    totalAmount: 87500.0,
    currency: "USD",
    status: "RECEIVED",
    priority: "URGENT",
    metadata: JSON.stringify({
      submittedBy: "hospital_system",
      channel: "electronic",
    }),
  },
  {
    claimNumber: "CLM-2024-005",
    patientName: "Jennifer Park",
    patientDob: "1989-04-17",
    patientId: "PAT-101456",
    insuranceId: "INS-HUMANA-567890",
    providerId: "PROV-DERM-023",
    providerName: "Sunshine Dermatology Associates",
    dateOfService: "2024-11-14",
    diagnosis: "Moderate plaque psoriasis",
    treatmentDetails:
      "Biologics injection, topical therapy, phototherapy session",
    totalAmount: 4100.0,
    currency: "USD",
    status: "RECEIVED",
    priority: "NORMAL",
    metadata: JSON.stringify({
      submittedBy: "provider_portal",
      channel: "electronic",
    }),
  },
  {
    claimNumber: "CLM-2024-006",
    patientName: "David Williams",
    patientDob: "1943-09-05",
    patientId: "PAT-101789",
    insuranceId: "INS-MEDICARE-678901",
    providerId: "PROV-NEURO-008",
    providerName: "Neurological Care Center",
    dateOfService: "2024-11-01",
    diagnosis: "Parkinson's disease with motor complications",
    treatmentDetails:
      "DBS adjustment, neurological evaluation, physical therapy referral",
    totalAmount: 12200.0,
    currency: "USD",
    status: "RECEIVED",
    priority: "HIGH",
    metadata: JSON.stringify({
      submittedBy: "specialist_portal",
      channel: "electronic",
    }),
  },
  {
    claimNumber: "CLM-2024-007",
    patientName: "Amanda Foster",
    patientDob: "2001-02-28",
    patientId: "PAT-102012",
    insuranceId: "INS-BCBS-789012",
    providerId: "PROV-PEDIAT-031",
    providerName: "Children's Wellness Center",
    dateOfService: "2024-11-13",
    diagnosis: "Acute asthma exacerbation, moderate",
    treatmentDetails:
      "Nebulizer treatment, systemic corticosteroids, 4-hour observation",
    totalAmount: 1650.0,
    currency: "USD",
    status: "RECEIVED",
    priority: "NORMAL",
    metadata: JSON.stringify({
      submittedBy: "provider_portal",
      channel: "electronic",
    }),
  },
  {
    claimNumber: "CLM-2024-008",
    patientName: "James Martinez",
    patientDob: "1967-11-14",
    patientId: "PAT-102345",
    insuranceId: "INS-AETNA-890123",
    providerId: "PROV-SURG-044",
    providerName: "Regional Surgical Group",
    dateOfService: "2024-10-28",
    diagnosis: "Inguinal hernia, bilateral",
    treatmentDetails: "Laparoscopic bilateral hernia repair, same-day surgery",
    totalAmount: 9800.0,
    currency: "USD",
    status: "RECEIVED",
    priority: "NORMAL",
    metadata: JSON.stringify({
      submittedBy: "hospital_system",
      channel: "electronic",
    }),
  },
];

const AGENTS = [
  "CLAIMS_RECEIVER",
  "OCR_PROCESSOR",
  "ICD_CONVERTER",
  "CUSTOMER_VERIFICATION",
  "FRAUD_DETECTION",
  "PAYMENT_GENERATOR",
];

async function main() {
  await prismaReady;
  console.log("🌱 Starting seed...");

  await prisma.claimLog.deleteMany();
  await prisma.claimEvent.deleteMany();
  await prisma.agentTask.deleteMany();
  await prisma.systemMetrics.deleteMany();
  await prisma.agentConfig.deleteMany();
  await prisma.claim.deleteMany();

  console.log("🗑️  Cleared existing data");

  for (const claim of sampleClaims) {
    const created = await prisma.claim.create({ data: claim as any });
    console.log(
      `✅ Created claim: ${created.claimNumber} — ${created.patientName}`,
    );
  }

  for (const agent of AGENTS) {
    await prisma.systemMetrics.create({
      data: { agentName: agent, totalProcessed: 0, totalFailed: 0 },
    });
  }

  // Seed default agent configurations
  const agentConfigs = [
    {
      agentName: "CLAIMS_RECEIVER",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      systemPrompt:
        "You are an insurance claim processing assistant. Your role is to receive, validate, and dispatch claims to appropriate processing agents.",
      temperature: 0.7,
      maxTokens: 4096,
    },
    {
      agentName: "OCR_PROCESSOR",
      provider: "anthropic",
      model: "claude-opus-4-5",
      systemPrompt:
        "You are an OCR and document processing AI with vision capabilities. Extract text and structured data from insurance claim documents with high accuracy.",
      temperature: 0.3,
      maxTokens: 8192,
    },
    {
      agentName: "ICD_CONVERTER",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      systemPrompt:
        "You are an ICD-10 medical coding expert. Convert diagnoses and procedures to appropriate ICD-10 codes with proper specificity.",
      temperature: 0.2,
      maxTokens: 2048,
    },
    {
      agentName: "CUSTOMER_VERIFICATION",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      systemPrompt:
        "You are an insurance customer verification specialist. Verify patient demographics, insurance eligibility, and coverage details.",
      temperature: 0.3,
      maxTokens: 2048,
    },
    {
      agentName: "FRAUD_DETECTION",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      systemPrompt:
        "You are an insurance fraud detection expert. Analyze claims for suspicious patterns, inconsistencies, and fraud indicators.",
      temperature: 0.4,
      maxTokens: 4096,
    },
    {
      agentName: "PAYMENT_GENERATOR",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      systemPrompt:
        "You are an insurance payment calculation specialist. Calculate appropriate payment amounts based on coverage, deductibles, and policy limits.",
      temperature: 0.2,
      maxTokens: 2048,
    },
  ];

  for (const config of agentConfigs) {
    await prisma.agentConfig.create({ data: config as any });
    console.log(`✅ Seeded config for: ${config.agentName}`);
  }

  await seedDefaultAdminUser();

  console.log("📊 Created system metrics & agent configurations");
  console.log(`\n🎉 Seed complete! ${sampleClaims.length} claims seeded.`);
}

main()
  .catch(console.error)
  .finally(() => (prisma as any).$disconnect?.());
