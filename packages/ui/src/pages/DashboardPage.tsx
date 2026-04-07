import { useQuery } from "@tanstack/react-query";
import { metricsApi, claimsApi } from "../api";
import {
  MetricsResponse,
  Claim,
  AGENT_META,
  AgentName,
  STATUS_COLOR,
} from "../types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Activity,
  Zap,
} from "lucide-react";
import AgentPipeline from "../components/agents/AgentPipeline";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import clsx from "clsx";
import { useTranslation } from "react-i18next";

export default function DashboardPage() {
  const { t } = useTranslation();
  const { data: metrics } = useQuery<MetricsResponse>({
    queryKey: ["metrics"],
    queryFn: metricsApi.get,
    refetchInterval: 10000,
  });

  const { data: claimsData } = useQuery<{ claims: Claim[] }>({
    queryKey: ["claims", "recent"],
    queryFn: () => claimsApi.list({ limit: 6 }),
    refetchInterval: 8000,
  });

  const statusData =
    metrics?.claimsByStatus?.map((s) => ({
      name: s.status.replace(/_/g, " "),
      count: s._count.status,
    })) || [];

  const totalProcessed =
    metrics?.agents?.reduce((s, a) => s + a.totalProcessed, 0) || 0;
  const totalFailed =
    metrics?.agents?.reduce((s, a) => s + a.totalFailed, 0) || 0;
  const completedClaims =
    metrics?.claimsByStatus?.find((s) => s.status === "COMPLETED")?._count
      .status || 0;
  const activeClaims =
    metrics?.claimsByStatus
      ?.filter((s) => !["COMPLETED", "FAILED", "RECEIVED"].includes(s.status))
      .reduce((s, c) => s + c._count.status, 0) || 0;

  const summaryCards = [
    {
      label: "Total Processed",
      value: totalProcessed,
      icon: TrendingUp,
      color: "text-indigo-400",
      bg: "bg-indigo-500/10",
    },
    {
      label: "Completed Claims",
      value: completedClaims,
      icon: CheckCircle2,
      color: "text-green-400",
      bg: "bg-green-500/10",
    },
    {
      label: "Active Processing",
      value: activeClaims,
      icon: Activity,
      color: "text-sky-400",
      bg: "bg-sky-500/10",
    },
    {
      label: "Failed Tasks",
      value: totalFailed,
      icon: AlertTriangle,
      color: "text-red-400",
      bg: "bg-red-500/10",
    },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-100">
          {t("pages.dashboard.title")}
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          {t("pages.dashboard.subtitle")}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="metric-card">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">{label}</span>
              <div className={clsx("p-1.5 rounded-lg", bg)}>
                <Icon size={14} className={color} />
              </div>
            </div>
            <div
              className={clsx("text-3xl font-display font-bold mt-2", color)}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Agent pipeline visualization */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={14} className="text-indigo-400" />
          <h2 className="text-sm font-semibold text-slate-200">
            Processing Pipeline
          </h2>
        </div>
        <AgentPipeline tasks={[]} />
        <div className="mt-4 grid grid-cols-3 gap-3 lg:grid-cols-6">
          {(Object.keys(AGENT_META) as AgentName[]).map((name) => {
            const meta = AGENT_META[name];
            const agentMetric = metrics?.agents?.find(
              (a) => a.agentName === name,
            );
            return (
              <div key={name} className="text-center">
                <div className="text-xs text-slate-500">{meta.label}</div>
                <div
                  className="text-sm font-medium mt-0.5"
                  style={{ color: meta.color }}
                >
                  {agentMetric?.totalProcessed ?? 0} tasks
                </div>
                {agentMetric?.avgDuration && (
                  <div className="text-xs text-slate-600">
                    {(agentMetric.avgDuration / 1000).toFixed(1)}s avg
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status chart */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">
            Claims by Status
          </h2>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={statusData}
                margin={{ top: 4, right: 4, bottom: 4, left: 0 }}
              >
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#475569", fontSize: 10 }}
                  angle={-20}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tick={{ fill: "#475569", fontSize: 11 }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  labelStyle={{ color: "#94a3b8" }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {statusData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={
                        [
                          "#6366f1",
                          "#0ea5e9",
                          "#10b981",
                          "#f59e0b",
                          "#ef4444",
                          "#8b5cf6",
                        ][i % 6]
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-slate-600">
              No data yet
            </div>
          )}
        </div>

        {/* Recent claims */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-200">
              Recent Claims
            </h2>
            <Link
              to="/claims"
              className="text-xs text-indigo-400 hover:text-indigo-300"
            >
              {t("pages.claims.viewAll")} →
            </Link>
          </div>
          <div className="space-y-2">
            {claimsData?.claims?.slice(0, 6).map((claim) => (
              <Link
                key={claim.id}
                to={`/claims/${claim.id}`}
                className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-800/60 transition-colors group"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-200 group-hover:text-indigo-300 transition-colors truncate">
                    {claim.patientName}
                  </div>
                  <div className="text-xs text-slate-500 font-mono">
                    {claim.claimNumber}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                  <span
                    className={clsx("status-badge", STATUS_COLOR[claim.status])}
                  >
                    {claim.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-slate-600">
                    {formatDistanceToNow(new Date(claim.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </Link>
            ))}
            {!claimsData?.claims?.length && (
              <div className="text-center py-8 text-slate-600 text-sm">
                {t("pages.claims.noClaims")}{" "}
                <Link
                  to="/claims/new"
                  className="text-indigo-400 hover:underline"
                >
                  {t("common.submit")} →
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
