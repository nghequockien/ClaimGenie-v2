import { useMemo, useState } from "react";
import { useLocation, Navigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../auth/AuthProvider";

export default function LoginPage() {
  const { user, isLoading, loginWith, loginWithPassword, signupWithPassword } =
    useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [form, setForm] = useState({
    name: "",
    email: "nghe@kien.digital",
    password: "12345678",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const from = useMemo(() => {
    const state = location.state as { from?: string } | null;
    return state?.from || "/dashboard";
  }, [location.state]);

  if (!isLoading && user) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (mode === "signin") {
        await loginWithPassword(form.email, form.password);
        toast.success("Signed in successfully");
      } else {
        await signupWithPassword(form.name, form.email, form.password);
        toast.success("Account created successfully");
      }
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          "Authentication failed",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card p-6 w-full max-w-lg space-y-5">
        <div className="flex gap-2">
          <button
            type="button"
            className={
              mode === "signin" ? "btn-primary flex-1" : "btn-secondary flex-1"
            }
            onClick={() => setMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={
              mode === "signup" ? "btn-primary flex-1" : "btn-secondary flex-1"
            }
            onClick={() => setMode("signup")}
          >
            Sign up
          </button>
        </div>

        <div>
          <h1 className="text-3xl md:text-4xl leading-[1.15] font-semibold tracking-[-0.02em] text-slate-100 break-words">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {mode === "signin"
              ? "Use email and password, or continue with SSO."
              : "Create a user account with email and password, or continue with SSO."}
          </p>
        </div>

        <form className="space-y-3" onSubmit={handleSubmit}>
          {mode === "signup" && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                Full name
              </label>
              <input
                className="input"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Your name"
                required
              />
            </div>
          )}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Email</label>
            <input
              type="email"
              className="input"
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
              placeholder="name@company.com"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              Password
            </label>
            <input
              type="password"
              className="input"
              value={form.password}
              onChange={(e) =>
                setForm((f) => ({ ...f, password: e.target.value }))
              }
              placeholder="At least 8 characters"
              minLength={8}
              required
            />
          </div>
          <button
            className="btn-primary w-full"
            disabled={isSubmitting || isLoading}
          >
            {isSubmitting
              ? mode === "signin"
                ? "Signing in..."
                : "Creating account..."
              : mode === "signin"
                ? "Sign in with email"
                : "Sign up with email"}
          </button>
        </form>

        <div className="relative">
          <div className="border-t border-slate-700/50" />
          <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--bg-surface)] px-2 text-xs text-slate-500">
            or continue with
          </span>
        </div>

        <button
          className="btn-secondary w-full"
          onClick={() => loginWith("google")}
          disabled={isLoading || isSubmitting}
        >
          Continue with Google
        </button>

        <button
          className="btn-secondary w-full"
          onClick={() => loginWith("linkedin")}
          disabled={isLoading || isSubmitting}
        >
          Continue with LinkedIn
        </button>
      </div>
    </div>
  );
}
