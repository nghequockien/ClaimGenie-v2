import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { metricsApi } from "../api";
import { useAppStore } from "../store";
import { AGENT_META, AgentName, LogLevel, ClaimLog } from "../types";
import {
  Activity,
  Cpu,
  Wifi,
  WifiOff,
  Trash2,
  Filter,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";
import { useTranslation } from "react-i18next";

const LOG_COLOR: Record<LogLevel, string> = {
  DEBUG: "text-slate-500",
  INFO: "text-sky-400",
  WARN: "text-amber-400",
  ERROR: "text-red-400",
};

const LOG_BG: Record<LogLevel, string> = {
  DEBUG: "",
  INFO: "",
  WARN: "bg-amber-500/5",
  ERROR: "bg-red-500/8",
};

export default function MonitoringPage() {
  const { t } = useTranslation();
  const { liveLogs, sseConnected, clearLogs, logFilter, setLogFilter } =
    useAppStore();
  const [autoScroll] = useState(true);

  const { data: health, refetch: refetchHealth } = useQuery({
    queryKey: ["agent-health"],
    queryFn: metricsApi.agentHealth,
    refetchInterval: 15000,
  });

  const { data: metrics } = useQuery({
    queryKey: ["metrics"],
    queryFn: metricsApi.get,
    refetchInterval: 10000,
  });

  // Auto-scroll to bottom in log panel
  useEffect(() => {
    if (!autoScroll) return;
    const el = document.getElementById("log-feed");
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveLogs, autoScroll]);

  const agents = Object.keys(AGENT_META) as AgentName[];

  const filtered = liveLogs.filter((log) => {
    if (logFilter.level !== "ALL" && log.level !== logFilter.level)
      return false;
    if (logFilter.agent !== "ALL" && log.agentName !== logFilter.agent)
      return false;
    if (
      logFilter.search &&
      !log.message.toLowerCase().includes(logFilter.search.toLowerCase())
    )
      return false;
    return true;
  });

  const errorCount = liveLogs.filter((l) => l.level === "ERROR").length;
  const warnCount = liveLogs.filter((l) => l.level === "WARN").length;
  const totalFailed =
    metrics?.agents?.reduce(
      (s: number, a: any) => s + (a.totalFailed || 0),
      0,
    ) || 0;

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-100">
            {t("pages.monitoring.title")}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {t("pages.monitoring.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              "flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border",
              sseConnected
                ? "text-green-400 bg-green-500/10 border-green-500/20"
                : "text-red-400 bg-red-500/10 border-red-500/20",
            )}
          >
            {sseConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
            {sseConnected
              ? t("pages.monitoring.live")
              : t("pages.monitoring.disconnected")}
          </div>
        </div>
      </div>

      {/* Summary pills */}
      <div className="flex gap-3 flex-wrap">
        <div className="metric-card flex-1 min-w-[120px] !py-3">
          <div className="text-xs text-slate-500">
            {t("pages.monitoring.totalLogs")}
          </div>
          <div className="text-xl font-bold font-mono text-slate-200">
            {liveLogs.length}
          </div>
        </div>
        <div
          className={clsx(
            "metric-card flex-1 min-w-[120px] !py-3",
            totalFailed > 0 && "border-red-500/40 bg-red-950/20",
          )}
        >
          <div className="flex items-center gap-1">
            <div className="text-xs text-slate-500">
              {t("pages.monitoring.failedTasks")}
            </div>
            {totalFailed > 0 && (
              <AlertTriangle size={10} className="text-red-400" />
            )}
          </div>
          <div
            className={clsx(
              "text-xl font-bold font-mono",
              totalFailed > 0 ? "text-red-400" : "text-slate-400",
            )}
          >
            {totalFailed}
          </div>
        </div>
        <div className="metric-card flex-1 min-w-[120px] !py-3">
          <div className="text-xs text-slate-500">
            {t("pages.monitoring.errors")}
          </div>
          <div
            className={clsx(
              "text-xl font-bold font-mono",
              errorCount > 0 ? "text-red-400" : "text-slate-400",
            )}
          >
            {errorCount}
          </div>
        </div>
        <div className="metric-card flex-1 min-w-[120px] !py-3">
          <div className="text-xs text-slate-500">
            {t("pages.monitoring.warnings")}
          </div>
          <div
            className={clsx(
              "text-xl font-bold font-mono",
              warnCount > 0 ? "text-amber-400" : "text-slate-400",
            )}
          >
            {warnCount}
          </div>
        </div>
        <div className="metric-card flex-1 min-w-[120px] !py-3">
          <div className="text-xs text-slate-500">
            {t("pages.monitoring.filtered")}
          </div>
          <div className="text-xl font-bold font-mono text-slate-200">
            {filtered.length}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Agent health grid */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Cpu size={14} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-300">
              {t("pages.monitoring.agentHealth")}
            </h2>
            <button
              onClick={() => refetchHealth()}
              className="ml-auto text-xs text-slate-500 hover:text-slate-300"
            >
              ↻
            </button>
          </div>

          {agents.map((agent) => {
            const meta = AGENT_META[agent];
            const agentHealthKey = agent;
            const health_status =
              health?.agents?.[agentHealthKey]?.status || "unknown";
            const isHealthy = health_status === "healthy";
            const agentMetric = metrics?.agents?.find(
              (a: any) => a.agentName === agent,
            );

            return (
              <div
                key={agent}
                className={clsx(
                  "card p-3 flex items-center gap-3 transition-all",
                  isHealthy
                    ? "border-slate-700/50"
                    : "border-red-500/30 bg-red-950/10",
                )}
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: isHealthy ? "#22c55e" : "#ef4444",
                    boxShadow: isHealthy
                      ? "0 0 6px #22c55e60"
                      : "0 0 6px #ef444460",
                  }}
                />
                <span className="text-base">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-200 truncate">
                    {meta.label}
                  </div>
                  <div className="text-xs text-slate-500">
                    {agentMetric ? (
                      <>
                        <span>{agentMetric.totalProcessed} tasks</span>
                        {agentMetric.totalFailed > 0 && (
                          <span className="text-red-400 ml-1 font-medium">
                            · {agentMetric.totalFailed} failed
                          </span>
                        )}
                      </>
                    ) : (
                      "No data"
                    )}
                  </div>
                </div>
                <div
                  className={clsx(
                    "text-xs font-medium",
                    isHealthy ? "text-green-400" : "text-red-400",
                  )}
                >
                  {health_status}
                </div>
              </div>
            );
          })}
        </div>

        {/* Live log feed */}
        <div className="xl:col-span-2 space-y-3">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <Activity size={14} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-300 mr-1">
              {t("pages.monitoring.liveLogFeed")}
            </h2>
            <Filter size={12} className="text-slate-500 ml-auto" />
            <select
              className="text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              value={logFilter.level}
              onChange={(e) => setLogFilter({ level: e.target.value })}
            >
              <option value="ALL">All levels</option>
              {(["DEBUG", "INFO", "WARN", "ERROR"] as LogLevel[]).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <select
              className="text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              value={logFilter.agent}
              onChange={(e) => setLogFilter({ agent: e.target.value as any })}
            >
              <option value="ALL">All agents</option>
              {agents.map((a) => (
                <option key={a} value={a}>
                  {AGENT_META[a].label}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search…"
              className="text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)] w-28"
              value={logFilter.search}
              onChange={(e) => setLogFilter({ search: e.target.value })}
            />
            <button
              onClick={clearLogs}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] flex items-center gap-1"
            >
              <Trash2 size={11} /> Clear
            </button>
          </div>

          {/* Log stream */}
          <div className="card overflow-hidden">
            <div
              id="log-feed"
              className="h-[520px] overflow-y-auto font-mono text-xs bg-[var(--bg-surface)] p-3 space-y-0.5"
            >
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] gap-2">
                  <Activity size={24} className="opacity-30" />
                  <span>Waiting for events…</span>
                  {!sseConnected && (
                    <span className="text-[var(--danger)] text-xs">
                      SSE disconnected — check gateway
                    </span>
                  )}
                </div>
              ) : (
                [...filtered].reverse().map((log: ClaimLog) => (
                  <div
                    key={log.id}
                    className={clsx(
                      "flex gap-2 px-2 py-0.5 rounded",
                      LOG_BG[log.level],
                    )}
                  >
                    <span className="text-[var(--text-muted)] flex-shrink-0 w-[76px]">
                      {format(new Date(log.timestamp), "HH:mm:ss.SS")}
                    </span>
                    <span
                      className={clsx(
                        "w-[38px] font-bold flex-shrink-0",
                        LOG_COLOR[log.level],
                      )}
                    >
                      {log.level}
                    </span>
                    {log.agentName && (
                      <span
                        className="w-4 text-center flex-shrink-0"
                        style={{
                          color: AGENT_META[log.agentName]?.color || "#94a3b8",
                        }}
                      >
                        {AGENT_META[log.agentName]?.icon || "?"}
                      </span>
                    )}
                    {log.claimId && (
                      <span className="text-[var(--text-muted)] flex-shrink-0 font-mono">
                        [{log.claimId.slice(0, 6)}]
                      </span>
                    )}
                    <span className="text-[var(--text-primary)] flex-1 break-all">
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
