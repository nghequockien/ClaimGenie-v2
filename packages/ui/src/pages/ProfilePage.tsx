import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { authApi } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { useTranslation } from "react-i18next";

export default function ProfilePage() {
  const { t } = useTranslation();
  const { user, refresh } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setName(user?.name || "");
    setEmail(user?.email || "");
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword && newPassword !== confirmPassword) {
      toast.error(t("profile.messages.passwordMismatch"));
      return;
    }

    setIsSaving(true);
    try {
      await authApi.updateProfile({
        name,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });
      await refresh();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success(t("profile.messages.updateSuccess"));
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          t("profile.messages.updateFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-100">
          {t("profile.title")}
        </h1>
        <p className="text-sm text-slate-500 mt-1">{t("profile.subtitle")}</p>
      </div>

      <form className="card p-6 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">
            {t("profile.fields.name")}
          </label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5">
            {t("profile.fields.email")}
          </label>
          <input
            className="input opacity-70 cursor-not-allowed"
            value={email}
            disabled
          />
          <p className="text-xs text-slate-500 mt-1">
            {t("profile.emailLocked")}
          </p>
        </div>

        <div className="pt-2 border-t border-slate-700/40 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              {t("profile.fields.currentPassword")}
            </label>
            <input
              type="password"
              className="input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={t("profile.placeholders.currentPassword")}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              {t("profile.fields.newPassword")}
            </label>
            <input
              type="password"
              className="input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              placeholder={t("profile.placeholders.newPassword")}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              {t("profile.fields.confirmPassword")}
            </label>
            <input
              type="password"
              className="input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              placeholder={t("profile.placeholders.confirmPassword")}
            />
          </div>
        </div>

        <button className="btn-primary w-full" disabled={isSaving}>
          {isSaving ? t("profile.actions.saving") : t("profile.actions.save")}
        </button>
      </form>
    </div>
  );
}
