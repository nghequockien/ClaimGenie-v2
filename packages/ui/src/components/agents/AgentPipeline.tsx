import clsx from "clsx";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { AgentName, AgentTask, AGENT_META, TaskStatus } from "../../types";

interface AgentPipelineProps {
  tasks?: AgentTask[];
  compact?: boolean;
}

const PIPELINE_ORDER: AgentName[] = [
  "CLAIMS_RECEIVER",
  "OCR_PROCESSOR",
  "ICD_CONVERTER",
  "CUSTOMER_VERIFICATION",
  "FRAUD_DETECTION",
  "PAYMENT_GENERATOR",
];

const PARALLEL_GROUP: AgentName[] = [
  "OCR_PROCESSOR",
  "ICD_CONVERTER",
  "CUSTOMER_VERIFICATION",
  "FRAUD_DETECTION",
];

function TaskIcon({ status }: { status?: TaskStatus }) {
  if (!status || status === "PENDING")
    return <Clock size={14} className="text-slate-500" />;
  if (status === "RUNNING" || status === "RETRYING")
    return <Loader2 size={14} className="text-indigo-400 animate-spin" />;
  if (status === "WARNING")
    return <AlertTriangle size={14} className="text-yellow-300" />;
  if (status === "ALERT")
    return <AlertTriangle size={14} className="text-amber-400" />;
  if (status === "COMPLETED")
    return <CheckCircle2 size={14} className="text-green-400" />;
  if (status === "FAILED")
    return <XCircle size={14} className="text-red-400" />;
  return null;
}

function AgentCard({
  name,
  task,
  compact,
}: {
  name: AgentName;
  task?: AgentTask;
  compact?: boolean;
}) {
  const meta = AGENT_META[name];
  const status = task?.status;
  const retryCount = task?.retryCount ?? 0;

  const borderColor =
    !status || status === "PENDING"
      ? "border-slate-700/50"
      : status === "RUNNING" || status === "RETRYING"
        ? `border-[${meta.color}]/40`
        : status === "WARNING"
          ? "border-yellow-400/40"
          : status === "ALERT"
            ? "border-amber-500/40"
            : status === "COMPLETED"
              ? "border-green-500/30"
              : "border-red-500/30";

  const bgColor =
    !status || status === "PENDING"
      ? "bg-slate-800/30"
      : status === "RUNNING" || status === "RETRYING"
        ? "bg-slate-800/60"
        : status === "WARNING"
          ? "bg-yellow-950/20"
          : status === "ALERT"
            ? "bg-amber-950/25"
            : status === "COMPLETED"
              ? "bg-green-950/20"
              : "bg-red-950/20";

  return (
    <div
      className={clsx(
        "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-500",
        bgColor,
        borderColor,
        status === "RUNNING" && "shadow-lg",
      )}
      style={{
        boxShadow:
          status === "RUNNING" ? `0 0 16px ${meta.color}20` : undefined,
      }}
    >
      <div className="text-xl">{meta.icon}</div>
      {!compact && (
        <div className="text-center">
          <div className="text-xs font-medium text-slate-200 leading-tight">
            {meta.label}
          </div>
          {task?.duration && (
            <div className="text-xs text-slate-500 mt-0.5">
              {(task.duration / 1000).toFixed(1)}s
            </div>
          )}
        </div>
      )}
      <TaskIcon status={status} />
      {retryCount > 0 && (
        <div className="flex items-center gap-1 text-xs text-amber-400">
          <AlertTriangle size={10} />
          {retryCount}x
        </div>
      )}
      {(status === "FAILED" || status === "ALERT" || status === "WARNING") &&
        task?.errorMsg &&
        !compact && (
          <div
            className={clsx(
              "text-[10px] text-center leading-tight px-1 max-w-[90px] break-words line-clamp-3",
              status === "WARNING"
                ? "text-yellow-200/90"
                : status === "ALERT"
                  ? "text-amber-300/90"
                  : "text-red-400/90",
            )}
            title={task.errorMsg}
          >
            {task.errorMsg}
          </div>
        )}
    </div>
  );
}

export default function AgentPipeline({
  tasks = [],
  compact = false,
}: AgentPipelineProps) {
  const taskMap = tasks.reduce(
    (acc, t) => {
      acc[t.agentName] = t;
      return acc;
    },
    {} as Record<AgentName, AgentTask>,
  );

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {/* Entry agent */}
      <AgentCard
        name="CLAIMS_RECEIVER"
        task={taskMap["CLAIMS_RECEIVER"]}
        compact={compact}
      />

      {/* Arrow */}
      <div className="flex-shrink-0 text-slate-600 text-sm">--→</div>

      {/* Parallel group */}
      <div className="flex-shrink-0 border border-dashed border-slate-600/50 rounded-xl p-2 bg-slate-900/30">
        {!compact && (
          <div className="text-xs text-slate-500 text-center mb-2 font-mono">
            Parallel Processing (agents run simultaneously)
          </div>
        )}
        <div className="flex gap-2">
          {PARALLEL_GROUP.map((name) => (
            <AgentCard
              key={name}
              name={name}
              task={taskMap[name]}
              compact={compact}
            />
          ))}
        </div>
      </div>

      {/* Arrow */}
      <div className="flex-shrink-0 text-slate-600 text-sm">--→</div>

      {/* Payment generator (handoff) */}
      <div className="relative">
        <AgentCard
          name="PAYMENT_GENERATOR"
          task={taskMap["PAYMENT_GENERATOR"]}
          compact={compact}
        />
        {!compact && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-xs bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-full border border-violet-500/30 whitespace-nowrap">
            handoff
          </div>
        )}
      </div>
    </div>
  );
}
