import { useRef, useEffect, useState } from "react";
import clsx from "clsx";
import { Terminal, ChevronDown, Filter } from "lucide-react";
import { ClaimLog, AgentName, LogLevel, AGENT_META } from "../../types";
import { format } from "date-fns";

interface LogViewerProps {
  logs: ClaimLog[];
  autoScroll?: boolean;
  maxHeight?: string;
  showFilters?: boolean;
  title?: string;
}

const LOG_LEVEL_COLOR: Record<LogLevel, string> = {
  DEBUG: "text-slate-500",
  INFO: "text-amber-700",
  WARN: "text-amber-600",
  ERROR: "text-yellow-900",
};

const LOG_LEVEL_BG: Record<LogLevel, string> = {
  DEBUG: "bg-amber-50/70",
  INFO: "bg-amber-100/70",
  WARN: "bg-orange-100/70",
  ERROR: "bg-yellow-100/80",
};

export default function LogViewer({
  logs,
  autoScroll = true,
  maxHeight = "400px",
  showFilters = false,
  title,
}: LogViewerProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [levelFilter, setLevelFilter] = useState<LogLevel | "ALL">("ALL");
  const [agentFilter, setAgentFilter] = useState<AgentName | "ALL">("ALL");
  const [isAtBottom, setIsAtBottom] = useState(true);

  useEffect(() => {
    if (autoScroll && isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll, isAtBottom]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setIsAtBottom(atBottom);
  };

  const filtered = logs.filter((l) => {
    if (levelFilter !== "ALL" && l.level !== levelFilter) return false;
    if (agentFilter !== "ALL" && l.agentName !== agentFilter) return false;
    return true;
  });

  const agents = [
    ...new Set(logs.map((l) => l.agentName).filter(Boolean)),
  ] as AgentName[];

  const renderedLogs = filtered.map((log) => {
    const agentMeta = log.agentName ? AGENT_META[log.agentName] : undefined;

    return (
      <div
        key={log.id}
        className={clsx(
          "flex gap-3 px-2 py-1 rounded-md animate-slide-in",
          LOG_LEVEL_BG[log.level],
        )}
      >
        <span className="text-slate-600 flex-shrink-0 w-[88px]">
          {format(new Date(log.timestamp), "HH:mm:ss.SSS")}
        </span>

        <span
          className={clsx(
            "flex-shrink-0 w-[38px] font-bold uppercase",
            LOG_LEVEL_COLOR[log.level],
          )}
        >
          {log.level}
        </span>

        {agentMeta ? (
          <span
            className="flex-shrink-0 w-[24px] text-center rounded font-bold"
            style={{ color: agentMeta.color || "#94a3b8" }}
          >
            {agentMeta.icon || "?"}
          </span>
        ) : null}

        <span className="text-slate-200 flex-1 break-all">{log.message}</span>

        {Boolean(log.details) && (
          <details className="flex-shrink-0">
            <summary className="cursor-pointer text-slate-600 hover:text-slate-400">
              <ChevronDown size={12} className="inline" />
            </summary>
            <pre className="mt-1 text-slate-400 text-xs overflow-x-auto max-w-xs">
              {JSON.stringify(log.details, null, 2)}
            </pre>
          </details>
        )}
      </div>
    );
  });

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-300">
            {title || "Processing Logs"}
          </span>
          <span className="text-xs text-slate-500 font-mono">
            {filtered.length} entries
          </span>
        </div>
        {showFilters && (
          <div className="flex items-center gap-2">
            <Filter size={12} className="text-slate-500" />
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as any)}
              className="text-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-300 focus:outline-none"
            >
              <option value="ALL">All levels</option>
              {(["DEBUG", "INFO", "WARN", "ERROR"] as LogLevel[]).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            {agents.length > 1 && (
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value as any)}
                className="text-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-300 focus:outline-none"
              >
                <option value="ALL">All agents</option>
                {agents.map((a) => (
                  <option key={a} value={a}>
                    {AGENT_META[a]?.label || a}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="overflow-y-auto font-mono text-xs leading-relaxed bg-[#fffce6]"
        style={{ maxHeight }}
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-slate-600">
            No logs yet...
          </div>
        ) : (
          <div className="p-3 space-y-0.5">
            {renderedLogs}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {!isAtBottom && (
        <button
          onClick={() => {
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            setIsAtBottom(true);
          }}
          className="absolute bottom-14 right-4 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded-full border border-slate-600"
        >
          Latest
        </button>
      )}
    </div>
  );
}
