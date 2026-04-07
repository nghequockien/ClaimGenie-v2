import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { claimsApi } from "../api";
import { Claim, STATUS_COLOR, PRIORITY_COLOR, AGENT_META } from "../types";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  DollarSign,
  Shield,
  User,
  FileText,
  Image as ImageIcon,
  File,
} from "lucide-react";
import AgentPipeline from "../components/agents/AgentPipeline";
import LogViewer from "../components/claims/LogViewer";
import { format } from "date-fns";
import clsx from "clsx";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "tif", "tiff"]);

function getFileNameFromPath(filePath: string) {
  const segments = filePath.split(/[/\\]/);
  return segments[segments.length - 1] || filePath;
}

function getFileExtension(filePath: string) {
  const fileName = getFileNameFromPath(filePath);
  const lastDotIndex = fileName.lastIndexOf(".");
  return lastDotIndex >= 0
    ? fileName.slice(lastDotIndex + 1).toLowerCase()
    : "";
}

export default function ClaimDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<
    "overview" | "logs" | "tasks" | "results" | "documents"
  >("overview");
  const [selectedDocumentIndex, setSelectedDocumentIndex] = useState(0);

  const {
    data: claim,
    isLoading,
    isError,
  } = useQuery<Claim>({
    queryKey: ["claim", id],
    queryFn: () => claimsApi.get(id!),
    refetchInterval: (q) => {
      const s = (q.state.data as Claim)?.status;
      return s === "COMPLETED" || s === "FAILED" ? false : 4000;
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (!id || (!isLoading && (isError || !claim))) {
      navigate("/dashboard", { replace: true });
    }
  }, [id, isLoading, isError, claim, navigate]);

  useEffect(() => {
    setSelectedDocumentIndex(0);
  }, [id, claim?.updatedAt]);

  const metadataDocumentPaths = Array.isArray(claim?.metadata?.documentPaths)
    ? claim.metadata.documentPaths.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      )
    : [];
  const documentPaths =
    metadataDocumentPaths.length > 0
      ? metadataDocumentPaths
      : claim?.documentPath
        ? [claim.documentPath]
        : [];
  const documents = documentPaths.map((documentPath, index) => {
    const extension = getFileExtension(documentPath);
    const type =
      extension === "pdf"
        ? "pdf"
        : IMAGE_EXTENSIONS.has(extension)
          ? "image"
          : "other";
    return {
      index,
      path: documentPath,
      name: getFileNameFromPath(documentPath),
      extension,
      type,
      previewUrl: id ? claimsApi.documentContentUrl(id, index) : "",
    };
  });
  const selectedDocument = documents[selectedDocumentIndex] ?? null;

  const retryMutation = useMutation({
    mutationFn: () => claimsApi.retry(id!),
    onSuccess: () => {
      toast.success(t("pages.claimDetail.claimResubmitted"));
      qc.invalidateQueries({ queryKey: ["claim", id] });
    },
    onError: (e: any) =>
      toast.error(
        e?.response?.data?.error || t("pages.claimDetail.retryFailed"),
      ),
  });

  if (isLoading)
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        {t("pages.claimDetail.loadingClaim")}
      </div>
    );

  if (!claim) return null;

  const isFailed =
    claim.status === "FAILED" ||
    claim.status.endsWith("_FAILED") ||
    claim.status === "FRAUD_FLAGGED";
  const isCompleted = claim.status === "COMPLETED";
  const isProcessing = !isFailed && !isCompleted;

  const tabs = [
    { id: "overview", label: t("pages.claimDetail.tabs.overview") },
    {
      id: "logs",
      label: t("pages.claimDetail.tabs.logs", {
        count: claim.logs?.length ?? 0,
      }),
    },
    {
      id: "tasks",
      label: t("pages.claimDetail.tabs.tasks", {
        count: claim.tasks?.length ?? 0,
      }),
    },
    { id: "results", label: t("pages.claimDetail.tabs.results") },
    { id: "documents", label: t("pages.claimDetail.tabs.documents") },
  ] as const;

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/claims"
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-xl font-bold text-slate-100">
                {claim.patientName}
              </h1>
              <span
                className={clsx("status-badge", STATUS_COLOR[claim.status])}
              >
                {claim.status.replace(/_/g, " ")}
              </span>
              <span
                className={clsx("status-badge", PRIORITY_COLOR[claim.priority])}
              >
                {claim.priority}
              </span>
            </div>
            <div className="text-sm text-slate-500 font-mono mt-0.5">
              {claim.claimNumber}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {(isFailed || isProcessing) && (
            <button
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              <RefreshCw
                size={14}
                className={retryMutation.isPending ? "animate-spin" : ""}
              />
              {retryMutation.isPending
                ? t("pages.claimDetail.retrying")
                : t("pages.claimDetail.rerunProcessing")}
            </button>
          )}
        </div>
      </div>

      {/* Pipeline status */}
      <div className="card p-4">
        <AgentPipeline tasks={claim.tasks} />
      </div>

      {/* Failed alert */}
      {isFailed && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <AlertTriangle
            size={18}
            className="text-red-400 mt-0.5 flex-shrink-0"
          />
          <div>
            <div className="font-medium text-red-300 text-sm">
              {t("pages.claimDetail.processingFailed")}
            </div>
            <div className="text-xs text-red-400/80 mt-0.5">
              {claim.tasks
                ?.filter((t) => t.status === "FAILED")
                .map((t) => (
                  <div key={t.id}>
                    • {AGENT_META[t.agentName]?.label}: {t.errorMsg}
                  </div>
                ))}
            </div>
            <button
              onClick={() => retryMutation.mutate()}
              className="mt-2 text-xs text-red-400 underline hover:text-red-300"
            >
              {t("pages.claimDetail.failedStepsHint")}
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-700/50">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                activeTab === tab.id
                  ? "border-indigo-500 text-indigo-300"
                  : "border-transparent text-slate-500 hover:text-slate-300",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Claim info */}
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <User size={14} /> {t("pages.claimDetail.patientClaimDetails")}
            </h3>
            <dl className="space-y-2">
              {[
                [t("pages.claimDetail.patientName"), claim.patientName],
                [t("pages.claimDetail.dateOfBirth"), claim.patientDob],
                [t("pages.claimDetail.patientId"), claim.patientId],
                [t("pages.claimDetail.insuranceId"), claim.insuranceId],
                [t("pages.claimDetail.provider"), claim.providerName],
                [t("pages.claimDetail.providerId"), claim.providerId],
                [t("pages.claimDetail.dateOfService"), claim.dateOfService],
                [
                  t("pages.claimDetail.totalAmount"),
                  `$${claim.totalAmount.toLocaleString()} ${claim.currency}`,
                ],
                [
                  t("pages.claimDetail.submitted"),
                  format(new Date(claim.createdAt), "PPpp"),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between text-sm py-1 border-b border-slate-700/30 last:border-0"
                >
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="text-slate-200 font-medium text-right max-w-[60%] break-all">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {claim.diagnosis && (
              <div className="pt-2">
                <div className="text-xs text-slate-500 mb-1">
                  {t("pages.claimDetail.diagnosis")}
                </div>
                <div className="text-sm text-slate-200 bg-slate-800/50 rounded-lg p-3">
                  {claim.diagnosis}
                </div>
              </div>
            )}
          </div>

          {/* Verification + Fraud summary */}
          <div className="space-y-4">
            {claim.verificationData && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                  <Shield size={14} />{" "}
                  {t("pages.claimDetail.verificationResult")}
                </h3>
                <div className="space-y-2">
                  {[
                    [
                      t("pages.claimDetail.patientMatch"),
                      claim.verificationData.patientMatch,
                    ],
                    [
                      t("pages.claimDetail.insuranceValid"),
                      claim.verificationData.insuranceValid,
                    ],
                    [
                      t("pages.claimDetail.policyActive"),
                      claim.verificationData.policyActive,
                    ],
                  ].map(([label, ok]) => (
                    <div
                      key={label as string}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-slate-400">{label as string}</span>
                      {ok ? (
                        <CheckCircle2 size={14} className="text-green-400" />
                      ) : (
                        <XCircle size={14} className="text-red-400" />
                      )}
                    </div>
                  ))}
                  {claim.verificationData.coverageDetails && (
                    <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1">
                      <div className="text-xs text-slate-500">
                        {t("pages.claimDetail.coverage")}:{" "}
                        {claim.verificationData.coverageDetails.planName}
                      </div>
                      <div className="text-xs text-slate-400">
                        {claim.verificationData.coverageDetails.coveragePercent}
                        {t("pages.claimDetail.coveredPercent")} •{" "}
                        {t("pages.claimDetail.deductible")}: $
                        {claim.verificationData.coverageDetails.deductible.toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {claim.fraudScore !== null && claim.fraudScore !== undefined && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-slate-300 mb-3">
                  {t("pages.claimDetail.fraudRiskScore")}
                </h3>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 bg-slate-700/50 rounded-full h-2">
                    <div
                      className={clsx(
                        "h-2 rounded-full transition-all duration-500",
                        claim.fraudScore < 30
                          ? "bg-green-500"
                          : claim.fraudScore < 60
                            ? "bg-amber-500"
                            : "bg-red-500",
                      )}
                      style={{ width: `${claim.fraudScore}%` }}
                    />
                  </div>
                  <span
                    className={clsx(
                      "text-lg font-bold font-mono",
                      claim.fraudScore < 30
                        ? "text-green-400"
                        : claim.fraudScore < 60
                          ? "text-amber-400"
                          : "text-red-400",
                    )}
                  >
                    {claim.fraudScore}/100
                  </span>
                </div>
                {claim.fraudFlags && claim.fraudFlags.length > 0 && (
                  <div className="space-y-1.5">
                    {claim.fraudFlags.map((flag, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 text-xs p-2 rounded bg-amber-500/10 border border-amber-500/20"
                      >
                        <AlertTriangle
                          size={11}
                          className="text-amber-400 mt-0.5 flex-shrink-0"
                        />
                        <div>
                          <span className="font-medium text-amber-300">
                            {flag.type}
                          </span>
                          <span className="text-amber-400/70 ml-2">
                            {flag.description}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {claim.paymentData && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                  <DollarSign size={14} className="text-violet-400" />
                  {t("pages.claimDetail.paymentSummary")}
                </h3>
                <div className="space-y-2">
                  {[
                    [
                      t("pages.claimDetail.approvedAmount"),
                      `$${claim.paymentData.approvedAmount.toLocaleString()}`,
                    ],
                    [
                      t("pages.claimDetail.deductibleApplied"),
                      `-$${claim.paymentData.deductibleApplied.toLocaleString()}`,
                    ],
                    [
                      t("pages.claimDetail.netPayable"),
                      `$${claim.paymentData.netPayableAmount.toLocaleString()}`,
                    ],
                    [
                      t("pages.claimDetail.scheduledDate"),
                      claim.paymentData.scheduledPaymentDate,
                    ],
                    [
                      t("pages.claimDetail.paymentId"),
                      claim.paymentData.paymentId,
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex justify-between text-sm py-1 border-b border-slate-700/30 last:border-0"
                    >
                      <span className="text-slate-500">{label}</span>
                      <span
                        className={clsx(
                          "font-medium font-mono",
                          label === t("pages.claimDetail.netPayable")
                            ? "text-green-400"
                            : "text-slate-200",
                        )}
                      >
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "logs" && (
        <LogViewer
          logs={claim.logs || []}
          autoScroll
          showFilters
          maxHeight="600px"
        />
      )}

      {activeTab === "tasks" && (
        <div className="space-y-3">
          {claim.tasks?.map((task) => (
            <div key={task.id} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">
                    {AGENT_META[task.agentName]?.icon}
                  </span>
                  <span className="text-sm font-medium text-slate-200">
                    {AGENT_META[task.agentName]?.label}
                  </span>
                  <span
                    className={clsx(
                      "status-badge text-xs",
                      task.status === "COMPLETED"
                        ? "text-green-400 bg-green-500/10"
                        : task.status === "FAILED"
                          ? "text-red-400 bg-red-500/10"
                          : task.status === "RUNNING"
                            ? "text-sky-400 bg-sky-500/10"
                            : task.status === "RETRYING"
                              ? "text-amber-400 bg-amber-500/10"
                              : "text-slate-400 bg-slate-700/30",
                    )}
                  >
                    {task.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500 font-mono">
                  {task.duration
                    ? `${(task.duration / 1000).toFixed(2)}s`
                    : "—"}
                  {task.retryCount > 0 &&
                    ` · ${t("pages.claimDetail.retries", { count: task.retryCount })}`}
                </div>
              </div>
              {task.errorMsg && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2 font-mono">
                  {task.errorMsg}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === "results" && (
        <div className="space-y-4">
          {claim.icdCodes && claim.icdCodes.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">
                {t("pages.claimDetail.icd10Codes")}
              </h3>
              <div className="space-y-2">
                {claim.icdCodes.map((code) => (
                  <div
                    key={code.code}
                    className="flex items-center gap-3 py-2 border-b border-slate-700/30 last:border-0"
                  >
                    <span className="font-mono text-emerald-400 text-sm font-bold w-20">
                      {code.code}
                    </span>
                    <span className="text-sm text-slate-200 flex-1">
                      {code.description}
                    </span>
                    <span className="text-xs text-slate-500">
                      {Math.round(code.confidence * 100)}%
                    </span>
                    {code.billable && (
                      <span className="status-badge text-emerald-400 bg-emerald-500/10">
                        {t("pages.claimDetail.billable")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {claim.rawOcrText && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">
                {t("pages.claimDetail.ocrExtractedText")}
              </h3>
              <pre className="text-xs text-slate-400 font-mono whitespace-pre-wrap bg-slate-800/50 rounded-lg p-3 max-h-48 overflow-y-auto">
                {claim.rawOcrText}
              </pre>
            </div>
          )}
        </div>
      )}

      {activeTab === "documents" && (
        <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-5">
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <FileText size={14} /> {t("pages.claimDetail.documentList")}
            </h3>

            {documents.length > 0 ? (
              <div className="space-y-2">
                {documents.map((document) => (
                  <button
                    key={document.path}
                    type="button"
                    onClick={() => setSelectedDocumentIndex(document.index)}
                    className={clsx(
                      "w-full text-left rounded-xl border p-3 transition-colors",
                      selectedDocument?.index === document.index
                        ? "border-cyan-400/50 bg-cyan-500/10"
                        : "border-slate-700/50 bg-slate-800/40 hover:border-slate-600 hover:bg-slate-800/60",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {document.type === "image" ? (
                        <ImageIcon
                          size={16}
                          className="mt-0.5 text-cyan-300 shrink-0"
                        />
                      ) : document.type === "pdf" ? (
                        <FileText
                          size={16}
                          className="mt-0.5 text-rose-300 shrink-0"
                        />
                      ) : (
                        <File
                          size={16}
                          className="mt-0.5 text-slate-400 shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-100 break-all">
                          {document.name}
                        </div>
                        <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">
                          {document.extension ||
                            t("pages.claimDetail.unknownFileType")}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                {t("pages.claimDetail.noDocumentUploaded")}
              </div>
            )}
          </div>

          <div className="card p-5 space-y-4 min-h-[540px]">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <FileText size={14} /> {t("pages.claimDetail.documentPreview")}
              </h3>
              {selectedDocument && (
                <a
                  href={selectedDocument.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-cyan-300 hover:text-cyan-200 underline"
                >
                  {t("pages.claimDetail.openDocument")}
                </a>
              )}
            </div>

            {selectedDocument ? (
              <>
                <div className="text-sm font-medium text-slate-100 break-all">
                  {selectedDocument.name}
                </div>

                <div className="rounded-xl border border-slate-700/50 bg-slate-950/40 overflow-hidden min-h-[420px]">
                  {selectedDocument.type === "pdf" ? (
                    <iframe
                      key={selectedDocument.previewUrl}
                      src={selectedDocument.previewUrl}
                      title={selectedDocument.name}
                      className="w-full h-[640px] bg-white"
                    />
                  ) : selectedDocument.type === "image" ? (
                    <div className="flex items-center justify-center h-[640px] p-4">
                      <img
                        src={selectedDocument.previewUrl}
                        alt={selectedDocument.name}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3 h-[420px] text-center px-6">
                      <File size={28} className="text-slate-500" />
                      <div className="text-sm text-slate-400">
                        {t("pages.claimDetail.previewNotAvailable")}
                      </div>
                      <a
                        href={selectedDocument.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-secondary"
                      >
                        {t("pages.claimDetail.openDocument")}
                      </a>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[420px] rounded-xl border border-dashed border-slate-700/50 text-sm text-slate-500">
                {t("pages.claimDetail.selectDocumentToPreview")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
