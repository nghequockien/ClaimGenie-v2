import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authApi, AuthUser } from "../api";

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  loginWith: (provider: "google" | "linkedin") => void;
  loginWithPassword: (email: string, password: string) => Promise<AuthUser>;
  signupWithPassword: (
    name: string,
    email: string,
    password: string,
  ) => Promise<AuthUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = async () => {
    setIsLoading(true);
    try {
      const me = await authApi.me();
      setUser(me.authenticated ? me.user : null);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const loginWith = (provider: "google" | "linkedin") => {
    window.location.href = authApi.loginUrl(provider);
  };

  const loginWithPassword = async (email: string, password: string) => {
    const response = await authApi.login({ email, password });
    setUser(response.user);
    return response.user;
  };

  const signupWithPassword = async (
    name: string,
    email: string,
    password: string,
  ) => {
    const response = await authApi.signup({ name, email, password });
    setUser(response.user);
    return response.user;
  };

  const logout = async () => {
    await authApi.logout();
    setUser(null);
  };

  const value = useMemo(
    () => ({
      user,
      isLoading,
      refresh,
      loginWith,
      loginWithPassword,
      signupWithPassword,
      logout,
    }),
    [user, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
