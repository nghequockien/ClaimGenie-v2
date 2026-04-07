import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { claimsApi } from "../api";
import toast from "react-hot-toast";
import {
  Send,
  ChevronDown,
  Upload,
  FileText,
  X,
  AlertCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";

// Sample customers matching PAT-001…PAT-005 from the verification MCP mock server
const SAMPLE_CLAIMS = [
  {
    label: "John Smith — Knee Replacement",
    data: {
      patientName: "John Smith",
      patientDob: "1985-03-15",
      patientId: "PAT-001",
      insuranceId: "INS-BLUE-7823",
      providerId: "PROV-ORTHO-011",
      providerName: "Pacific Orthopedic Center",
      dateOfService: "2026-03-20",
      diagnosis: "Severe osteoarthritis, right knee",
      treatmentDetails:
        "Total right knee replacement, 2-day hospital stay, physical therapy referral",
      totalAmount: 42000,
      currency: "USD",
      priority: "NORMAL",
    },
  },
  {
    label: "Maria Garcia — Appendectomy",
    data: {
      patientName: "Maria Garcia",
      patientDob: "1992-07-22",
      patientId: "PAT-002",
      insuranceId: "INS-AETNA-4512",
      providerId: "PROV-HOSP-007",
      providerName: "Riverside General Hospital",
      dateOfService: "2026-03-28",
      diagnosis: "Acute appendicitis with abscess",
      treatmentDetails:
        "Laparoscopic appendectomy, 2-day hospital stay, post-op antibiotics",
      totalAmount: 19800,
      currency: "USD",
      priority: "HIGH",
    },
  },
  {
    label: "Robert Chen — Cardiac Stent",
    data: {
      patientName: "Robert Chen",
      patientDob: "1978-11-04",
      patientId: "PAT-003",
      insuranceId: "INS-UNITED-9921",
      providerId: "PROV-CARD-022",
      providerName: "Heart & Vascular Institute",
      dateOfService: "2026-04-01",
      diagnosis: "Acute myocardial infarction, anterior wall",
      treatmentDetails:
        "Emergency PCI with drug-eluting stent placement, 4-day ICU stay",
      totalAmount: 91500,
      currency: "USD",
      priority: "URGENT",
    },
  },
  {
    // PAT-004 has an expired policy — verification will fail, demonstrating the failure path
    label: "Emily Johnson — Hip Fracture (expired policy)",
    data: {
      patientName: "Emily Johnson",
      patientDob: "1965-05-30",
      patientId: "PAT-004",
      insuranceId: "INS-HUMANA-3344",
      providerId: "PROV-HOSP-003",
      providerName: "Metro General Hospital",
      dateOfService: "2026-04-03",
      diagnosis: "Displaced femoral neck fracture, right hip",
      treatmentDetails:
        "Hemiarthroplasty, 5-day hospital stay, rehabilitation referral",
      totalAmount: 58000,
      currency: "USD",
      priority: "HIGH",
    },
  },
  {
    label: "David Kim — Diabetes Management",
    data: {
      patientName: "David Kim",
      patientDob: "2000-09-18",
      patientId: "PAT-005",
      insuranceId: "INS-CIGNA-5567",
      providerId: "PROV-CLINIC-034",
      providerName: "Sunrise Family Clinic",
      dateOfService: "2026-04-05",
      diagnosis: "Type 2 diabetes mellitus, uncontrolled",
      treatmentDetails:
        "HbA1c testing, insulin adjustment, continuous glucose monitor fitting, dietary consultation",
      totalAmount: 1250,
      currency: "USD",
      priority: "NORMAL",
    },
  },
  {
    // Uses watchlisted provider PROV-SURG-044 from fraud MCP mock data.
    // Customer identity/policy are valid so verification passes while fraud is flagged.
    label: "Robert Chen — Hernia Repair (fraud flag demo)",
    data: {
      patientName: "Robert Chen",
      patientDob: "1978-11-04",
      patientId: "PAT-003",
      insuranceId: "INS-UNITED-9921",
      providerId: "PROV-SURG-044",
      providerName: "Regional Surgical Group",
      dateOfService: "2026-04-06",
      diagnosis: "Inguinal hernia",
      treatmentDetails:
        "Laparoscopic hernia repair with mesh, outpatient observation, follow-up scheduled",
      totalAmount: 18600,
      currency: "USD",
      priority: "HIGH",
    },
  },
];

const FIELD_GROUPS = [
  {
    title: "Patient Information",
    fields: [
      {
        id: "patientName",
        label: "Patient Name",
        type: "text",
        placeholder: "Full legal name",
      },
      { id: "patientDob", label: "Date of Birth", type: "date" },
      {
        id: "patientId",
        label: "Patient ID",
        type: "text",
        placeholder: "PAT-XXXXXX",
      },
      {
        id: "insuranceId",
        label: "Insurance ID",
        type: "text",
        placeholder: "INS-XXXX-XXXXXX",
      },
    ],
  },
  {
    title: "Provider Information",
    fields: [
      {
        id: "providerId",
        label: "Provider ID",
        type: "text",
        placeholder: "PROV-XXXX-XXX",
      },
      {
        id: "providerName",
        label: "Provider Name",
        type: "text",
        placeholder: "Hospital or clinic name",
      },
      { id: "dateOfService", label: "Date of Service", type: "date" },
      {
        id: "totalAmount",
        label: "Billed Amount (USD)",
        type: "number",
        placeholder: "0.00",
      },
    ],
  },
  {
    title: "Clinical Details",
    fields: [
      {
        id: "diagnosis",
        label: "Diagnosis",
        type: "textarea",
        placeholder: "Primary diagnosis description…",
      },
      {
        id: "treatmentDetails",
        label: "Treatment Details",
        type: "textarea",
        placeholder: "Procedures and treatments performed…",
      },
    ],
  },
];

const ACCEPTED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
];
const ACCEPTED_EXT = ".pdf,.png,.jpg,.jpeg,.tiff,.tif";
const MAX_SIZE = 20 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function NewClaimPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const fieldGroups = [
    {
      title: t("pages.newClaim.patientInfo"),
      fields: [
        {
          id: "patientName",
          label: t("pages.newClaim.patientName"),
          type: "text",
          placeholder: t("pages.newClaim.fullLegalName"),
        },
        {
          id: "patientDob",
          label: t("pages.newClaim.dateOfBirth"),
          type: "date",
          placeholder: "",
        },
        {
          id: "patientId",
          label: t("pages.newClaim.patientId"),
          type: "text",
          placeholder: "PAT-XXXXXX",
        },
        {
          id: "insuranceId",
          label: t("pages.newClaim.insuranceId"),
          type: "text",
          placeholder: "INS-XXXX-XXXXXX",
        },
      ],
    },
    {
      title: t("pages.newClaim.providerInfo"),
      fields: [
        {
          id: "providerId",
          label: t("pages.newClaim.providerId"),
          type: "text",
          placeholder: "PROV-XXXX-XXX",
        },
        {
          id: "providerName",
          label: t("pages.newClaim.providerName"),
          type: "text",
          placeholder: t("pages.newClaim.hospitalOrClinic"),
        },
        {
          id: "dateOfService",
          label: t("pages.newClaim.dateOfService"),
          type: "date",
          placeholder: "",
        },
        {
          id: "totalAmount",
          label: t("pages.newClaim.billedAmount"),
          type: "number",
          placeholder: "0.00",
        },
      ],
    },
    {
      title: t("pages.newClaim.clinicalDetails"),
      fields: [
        {
          id: "diagnosis",
          label: t("pages.newClaim.diagnosis"),
          type: "textarea",
          placeholder: t("pages.newClaim.primaryDiagnosis"),
        },
        {
          id: "treatmentDetails",
          label: t("pages.newClaim.treatmentDetails"),
          type: "textarea",
          placeholder: t("pages.newClaim.proceduresTreatments"),
        },
      ],
    },
  ];
  const [form, setForm] = useState<Record<string, string>>({
    currency: "USD",
    priority: "NORMAL",
  });
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const nextFiles = Array.from(files);
    const validFiles: File[] = [];

    for (const file of nextFiles) {
      if (!ACCEPTED_MIME.includes(file.type)) {
        toast.error(t("pages.newClaim.invalidFileType"));
        continue;
      }
      if (file.size > MAX_SIZE) {
        toast.error(t("pages.newClaim.fileTooLarge"));
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    setUploadedFiles((currentFiles) => {
      const existingKeys = new Set(
        currentFiles.map(
          (file) => `${file.name}:${file.size}:${file.lastModified}`,
        ),
      );
      const dedupedFiles = validFiles.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });

      return [...currentFiles, ...dedupedFiles];
    });
  };

  const mutation = useMutation({
    mutationFn: (payload: { data: Record<string, unknown>; files?: File[] }) =>
      payload.files && payload.files.length > 0
        ? claimsApi.createWithDocuments(payload.data, payload.files)
        : claimsApi.create(payload.data),
    onSuccess: (claim) => {
      toast.success(`Claim ${claim.claimNumber} submitted!`);
      navigate(`/claims/${claim.id}`);
    },
    onError: (e: any) => {
      const message =
        e?.response?.data?.details ||
        e?.response?.data?.error ||
        e?.message ||
        "Submission failed";
      toast.error(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      ...form,
      totalAmount: parseFloat(form.totalAmount || "0"),
      claimNumber: `CLM-${Date.now()}`,
    };
    mutation.mutate(
      uploadedFiles.length > 0 ? { data, files: uploadedFiles } : { data },
    );
  };

  const removeUploadedFile = (fileToRemove: File) => {
    setUploadedFiles((currentFiles) =>
      currentFiles.filter(
        (file) =>
          !(
            file.name === fileToRemove.name &&
            file.size === fileToRemove.size &&
            file.lastModified === fileToRemove.lastModified
          ),
      ),
    );
  };

  const loadSample = (sample: (typeof SAMPLE_CLAIMS)[0]) => {
    const mapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(sample.data)) {
      mapped[k] = String(v);
    }
    setForm(mapped);
    toast.success(`Loaded: ${sample.label}`);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-100">
          {t("pages.newClaim.title")}
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          {t("pages.newClaim.subtitle")}
        </p>
      </div>

      {/* Sample data loader */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <ChevronDown size={14} className="text-slate-400" />
          <span className="text-sm text-slate-400">
            {t("pages.newClaim.loadSample")}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_CLAIMS.map((s) => (
            <button
              key={s.label}
              onClick={() => loadSample(s)}
              className="btn-secondary text-xs"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {fieldGroups.map((group) => (
          <div key={group.title} className="card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-300 border-b border-slate-700/50 pb-2">
              {group.title}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {group.fields.map((field) => (
                <div
                  key={field.id}
                  className={field.type === "textarea" ? "sm:col-span-2" : ""}
                >
                  <label className="block text-xs text-slate-400 mb-1.5">
                    {field.label}
                  </label>
                  {field.type === "textarea" ? (
                    <textarea
                      className="input min-h-[80px] resize-y"
                      placeholder={field.placeholder}
                      value={form[field.id] || ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [field.id]: e.target.value }))
                      }
                    />
                  ) : (
                    <input
                      type={field.type}
                      className="input"
                      placeholder={field.placeholder}
                      value={form[field.id] || ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [field.id]: e.target.value }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Priority */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-300 border-b border-slate-700/50 pb-2 mb-4">
            {t("pages.newClaim.processingOptions")}
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                {t("pages.newClaim.priority")}
              </label>
              <select
                className="select"
                value={form.priority || "NORMAL"}
                onChange={(e) =>
                  setForm((f) => ({ ...f, priority: e.target.value }))
                }
              >
                {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                {t("pages.newClaim.currency")}
              </label>
              <select
                className="select"
                value={form.currency || "USD"}
                onChange={(e) =>
                  setForm((f) => ({ ...f, currency: e.target.value }))
                }
              >
                {["JPY", "USD", "VND", "CNY", "KRW"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Supporting Documents */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-300 border-b border-slate-700/50 pb-2 mb-4">
            {t("pages.newClaim.supportingDocs")}
          </h2>
          <label
            className={`flex flex-col items-center gap-2 p-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
              isDragOver
                ? "border-[var(--accent)] bg-[var(--bg-elevated)]"
                : "border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)]"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
          >
            <input
              type="file"
              accept={ACCEPTED_EXT}
              multiple
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Upload size={20} className="text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-secondary)]">
              {t("pages.newClaim.dragDrop")}{" "}
              <span className="text-[var(--accent)] font-medium">
                {t("pages.newClaim.browse")}
              </span>
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {t("pages.newClaim.fileTypes")}
            </p>
          </label>

          {uploadedFiles.length > 0 && (
            <div className="mt-3 space-y-2">
              {uploadedFiles.map((file) => {
                const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
                return (
                  <div
                    key={fileKey}
                    className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]"
                  >
                    <FileText
                      size={18}
                      className="text-[var(--accent)] shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {file.name}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {formatBytes(file.size)} · {t("pages.newClaim.ocrHint")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeUploadedFile(file)}
                      className="p-1 rounded hover:bg-[var(--bg-base)] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                      title={t("pages.newClaim.removeFile")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-2.5 text-xs text-[var(--text-muted)] flex items-center gap-1.5">
            <AlertCircle size={11} className="shrink-0" />
            {t("pages.newClaim.ocrAttachHint")}
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="btn-primary flex items-center gap-2 flex-1 justify-center"
          >
            <Send
              size={14}
              className={mutation.isPending ? "animate-pulse" : ""}
            />
            {mutation.isPending
              ? t("pages.newClaim.submitting")
              : t("pages.newClaim.submitClaim")}
          </button>
          <button
            type="button"
            onClick={() => {
              setForm({ currency: "USD", priority: "NORMAL" });
              setUploadedFiles([]);
            }}
            className="btn-secondary"
          >
            {t("common.clear")}
          </button>
        </div>
      </form>
    </div>
  );
}
