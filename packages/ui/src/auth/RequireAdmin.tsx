import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export default function RequireAdmin({ children }: { children: JSX.Element }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        Loading authentication...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (user.role !== "ADMIN") {
    return (
      <div className="max-w-2xl mx-auto mt-16 card p-6">
        <h2 className="text-lg font-semibold text-slate-100 mb-2">
          Access denied
        </h2>
        <p className="text-sm text-slate-400">
          Admin permission is required to access the Settings page.
        </p>
      </div>
    );
  }

  return children;
}
