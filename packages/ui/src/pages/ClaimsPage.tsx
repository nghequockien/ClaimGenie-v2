import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { claimsApi } from "../api";
import { Claim, STATUS_COLOR, PRIORITY_COLOR } from "../types";
import {
  Plus,
  Search,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import clsx from "clsx";
import { useTranslation } from "react-i18next";

const STATUSES = [
  "",
  "RECEIVED",
  "OCR_PROCESSING",
  "COMPLETED",
  "FAILED",
  "FRAUD_FLAGGED",
  "PAYMENT_GENERATED",
];

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100] as const;

type SortField = "createdAt" | "priority";
type SortDir = "asc" | "desc";

const PRIORITY_RANK: Record<string, number> = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  URGENT: 4,
};

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active)
    return <ChevronsUpDown size={12} className="text-slate-600 ml-1" />;
  return dir === "asc" ? (
    <ChevronUp size={12} className="text-indigo-400 ml-1" />
  ) : (
    <ChevronDown size={12} className="text-indigo-400 ml-1" />
  );
}

export default function ClaimsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] =
    useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20);
  const [sortBy, setSortBy] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
    setPage(0);
  };

  const { data, isLoading, refetch, isFetching } = useQuery<{
    claims: Claim[];
    total: number;
  }>({
    queryKey: ["claims", statusFilter, page, pageSize, sortBy, sortDir],
    queryFn: () =>
      claimsApi.list({
        status: statusFilter || undefined,
        limit: pageSize,
        offset: page * pageSize,
        sortBy,
        sortDir,
      }),
    refetchInterval: 10000,
  });

  const claims = data?.claims || [];
  const filtered = search
    ? claims.filter(
        (c) =>
          c.patientName.toLowerCase().includes(search.toLowerCase()) ||
          c.claimNumber.toLowerCase().includes(search.toLowerCase()) ||
          c.insuranceId.toLowerCase().includes(search.toLowerCase()),
      )
    : claims;

  // Priority sort is applied client-side on the current page (URGENT > HIGH > NORMAL > LOW)
  const sorted =
    sortBy === "priority"
      ? [...filtered].sort((a, b) => {
          const aRank = PRIORITY_RANK[a.priority] ?? 0;
          const bRank = PRIORITY_RANK[b.priority] ?? 0;
          return sortDir === "asc" ? aRank - bRank : bRank - aRank;
        })
      : filtered;

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-100">
            {t("pages.claims.title")}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {t("pages.claims.total", { count: data?.total ?? 0 })}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className={clsx(
              "btn-secondary flex items-center gap-2",
              isFetching && "opacity-70",
            )}
          >
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
            {t("common.refresh")}
          </button>
          <Link
            to="/claims/new"
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={14} /> {t("pages.claims.newClaim")}
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            className="input pl-8"
            placeholder={t("pages.claims.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="select w-48"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="">{t("pages.claims.allStatuses")}</option>
          {STATUSES.filter(Boolean).map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select
          className="select w-40"
          value={pageSize}
          onChange={(e) => {
            setPageSize(
              Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number],
            );
            setPage(0);
          }}
          aria-label="Rows per page"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size} rows
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50 bg-slate-800/30">
              {(
                [
                  {
                    key: "claimNumber",
                    label: t("pages.claims.columns.claimNumber"),
                  },
                  { key: "patient", label: t("pages.claims.columns.patient") },
                  {
                    key: "provider",
                    label: t("pages.claims.columns.provider"),
                  },
                  { key: "amount", label: t("pages.claims.columns.amount") },
                  { key: "status", label: t("pages.claims.columns.status") },
                  {
                    key: "priority" as const,
                    label: t("pages.claims.columns.priority"),
                    sortField: "priority" as SortField,
                  },
                  {
                    key: "submitted" as const,
                    label: t("pages.claims.columns.submitted"),
                    sortField: "createdAt" as SortField,
                  },
                ] as const
              ).map((col) => (
                <th
                  key={col.key}
                  onClick={
                    "sortField" in col
                      ? () => handleSort(col.sortField)
                      : undefined
                  }
                  className={clsx(
                    "text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider",
                    "sortField" in col &&
                      "cursor-pointer select-none hover:text-slate-200 transition-colors",
                  )}
                >
                  <span className="inline-flex items-center">
                    {col.label}
                    {"sortField" in col && (
                      <SortIcon
                        active={sortBy === col.sortField}
                        dir={sortDir}
                      />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-700/30">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div
                        className="h-4 bg-slate-700/50 rounded animate-pulse"
                        style={{ width: `${40 + Math.random() * 40}%` }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-16 text-slate-600">
                  {t("pages.claims.noClaims")}
                </td>
              </tr>
            ) : (
              sorted.map((claim) => (
                <tr key={claim.id} className="table-row">
                  <td className="px-4 py-3">
                    <Link
                      to={`/claims/${claim.id}`}
                      className="font-mono text-indigo-400 hover:text-indigo-300 text-xs"
                    >
                      {claim.claimNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-200">
                      {claim.patientName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {claim.patientId}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-300 text-xs truncate max-w-[160px]">
                      {claim.providerName}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-200">
                    ${claim.totalAmount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        "status-badge",
                        STATUS_COLOR[claim.status],
                      )}
                    >
                      {claim.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        "status-badge",
                        PRIORITY_COLOR[claim.priority],
                      )}
                    >
                      {claim.priority}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-xs text-slate-500"
                    title={format(new Date(claim.createdAt), "PPpp")}
                  >
                    {formatDistanceToNow(new Date(claim.createdAt), {
                      addSuffix: true,
                    })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {(data?.total ?? 0) > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700/50 bg-slate-800/20">
            <span className="text-xs text-slate-500">
              Showing {page * pageSize + 1}–
              {Math.min((page + 1) * pageSize, data!.total)} of {data!.total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
                className="btn-secondary text-xs py-1 px-3 disabled:opacity-40"
              >
                ← {t("pages.claims.prev")}
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * pageSize >= (data?.total ?? 0)}
                className="btn-secondary text-xs py-1 px-3 disabled:opacity-40"
              >
                {t("pages.claims.next")} →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
