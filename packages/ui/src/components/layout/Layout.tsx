import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  Activity,
  LayoutDashboard,
  FileText,
  PlusCircle,
  Radio,
  Settings,
  ChevronDown,
} from "lucide-react";
import { useGlobalSSE } from "../../hooks/useSSE";
import { useAppStore } from "../../store";
import { useAuth } from "../../auth/AuthProvider";
import clsx from "clsx";
import { useTranslation } from "react-i18next";

const NAV = [
  { to: "/dashboard", icon: LayoutDashboard, key: "nav.dashboard", end: true },
  { to: "/claims", icon: FileText, key: "nav.claims", end: true },
  { to: "/claims/new", icon: PlusCircle, key: "nav.newClaim", end: false },
  { to: "/monitoring", icon: Activity, key: "nav.monitoring", end: false },
  { to: "/config", icon: Settings, key: "nav.configuration", end: false },
];

type ThemeName = "mint-default" | "cherry-blossom" | "chocolate-truffle";
const THEME_STORAGE_KEY = "ui-theme";

const THEME_OPTIONS: Array<{ value: ThemeName; label: string }> = [
  { value: "mint-default", label: "Mint Modern" },
  { value: "cherry-blossom", label: "Cherry Blossom" },
  { value: "chocolate-truffle", label: "Chocolate Truffle" },
];

export default function Layout() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (
      saved === "mint-default" ||
      saved === "cherry-blossom" ||
      saved === "chocolate-truffle"
    ) {
      return saved;
    }
    return "mint-default";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useGlobalSSE();
  const { sseConnected, liveLogs } = useAppStore();
  const location = useLocation();

  const recentErrors = liveLogs
    .filter((l) => l.level === "ERROR")
    .slice(0, 3).length;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 flex flex-col bg-slate-900/70 border-r border-slate-700/50 backdrop-blur-xl">
        {/* Logo */}
        <div className="px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 via-cyan-500 to-emerald-500 p-[1px] shadow-lg shadow-cyan-700/30">
              <div className="w-full h-full rounded-[11px] bg-slate-900/95 flex items-center justify-center">
                <svg
                  viewBox="0 0 48 48"
                  className="w-8 h-8"
                  role="img"
                  aria-label="Intelligent claims logo"
                >
                  <rect
                    x="13"
                    y="9"
                    width="22"
                    height="30"
                    rx="4"
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="2"
                  />
                  <path
                    d="M30 9v7h7"
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="19" cy="24" r="2.1" fill="#38bdf8" />
                  <circle cx="29" cy="21" r="2" fill="#a78bfa" />
                  <circle cx="30" cy="30" r="2" fill="#34d399" />
                  <path
                    d="M21 24l6-3m2 2l1 5m-9-2l7 4"
                    fill="none"
                    stroke="#64748b"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                  <path
                    d="M17 33l4 3 7-8"
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
            <div>
              <div className="font-display font-bold text-slate-100 text-base leading-none">
                ClaimGenie
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Intelligence Claims
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.filter(
            (item) => item.to !== "/config" || user?.role === "ADMIN",
          ).map(({ to, icon: Icon, key, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-indigo-600/20 text-indigo-300 shadow-sm"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60",
                )
              }
            >
              <Icon size={16} />
              {t(key)}
              {key === "nav.monitoring" && recentErrors > 0 && (
                <span className="ml-auto text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">
                  {recentErrors}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* SSE Status */}
        <div className="p-4 border-t border-slate-700/50">
          <div className="flex items-center gap-2 text-xs">
            <Radio
              size={12}
              className={sseConnected ? "text-green-400" : "text-red-400"}
            />
            <span className={sseConnected ? "text-green-400" : "text-red-400"}>
              {sseConnected
                ? t("common.liveStreamActive")
                : t("common.reconnecting")}
            </span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-slate-700/50 bg-slate-900/40 backdrop-blur-sm flex-shrink-0">
          <div className="text-sm text-slate-400 font-mono">
            {location.pathname.replace("/", "").replace("/", " / ") ||
              "dashboard"}
          </div>
          <div className="flex items-center gap-3">
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as ThemeName)}
              className="text-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-300 focus:outline-none"
              aria-label="theme-selector"
            >
              {THEME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={i18n.language}
              onChange={(e) => {
                void i18n.changeLanguage(e.target.value);
              }}
              className="text-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-300 focus:outline-none"
              aria-label="language-selector"
            >
              <option value="en">{t("languages.en")}</option>
              <option value="ja">{t("languages.ja")}</option>
              <option value="vi">{t("languages.vi")}</option>
              <option value="zh">{t("languages.zh")}</option>
              <option value="ko">{t("languages.ko")}</option>
            </select>
            <div
              className={clsx(
                "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full",
                sseConnected
                  ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400",
              )}
            >
              <span
                className={clsx(
                  "w-1.5 h-1.5 rounded-full",
                  sseConnected ? "bg-green-400 animate-pulse" : "bg-red-400",
                )}
              />
              {sseConnected ? t("common.connected") : t("common.offline")}
            </div>

            {user ? (
              <div className="relative group">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-sm text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors"
                >
                  <span className="max-w-[160px] truncate">
                    {user.name || user.email}
                  </span>
                  <ChevronDown size={14} />
                </button>
                <div className="absolute right-0 top-full pt-2 hidden group-hover:block group-focus-within:block z-20">
                  <div className="min-w-[180px] rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-xl p-1.5">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm rounded-lg text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                      onClick={() => navigate("/profile")}
                    >
                      {t("profile.menu.myProfile")}
                    </button>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm rounded-lg text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                      onClick={() => {
                        void (async () => {
                          await logout();
                          navigate("/login", { replace: true });
                        })();
                      }}
                    >
                      {t("profile.menu.signOut")}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs py-1 px-2"
                  onClick={() => navigate("/login")}
                >
                  Sign in
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <div className="p-6 animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
