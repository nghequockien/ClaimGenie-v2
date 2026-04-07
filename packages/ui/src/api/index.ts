import axios from "axios";

const BASE = import.meta.env.VITE_API_URL || "/api";

export const api = axios.create({
  baseURL: BASE,
  timeout: 30000,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "USER";
  provider: "google" | "linkedin" | "local";
};

export const authApi = {
  me: () =>
    api
      .get<{ authenticated: boolean; user: AuthUser | null }>("/auth/me")
      .then((r) => r.data),
  login: (data: { email: string; password: string }) =>
    api
      .post<{ authenticated: boolean; user: AuthUser }>("/auth/login", data)
      .then((r) => r.data),
  signup: (data: { name: string; email: string; password: string }) =>
    api
      .post<{ authenticated: boolean; user: AuthUser }>("/auth/signup", data)
      .then((r) => r.data),
  updateProfile: (data: {
    name: string;
    currentPassword?: string;
    newPassword?: string;
  }) =>
    api
      .put<{ authenticated: boolean; user: AuthUser }>("/auth/profile", data)
      .then((r) => r.data),
  logout: () => api.post("/auth/logout").then((r) => r.data),
  loginUrl: (provider: "google" | "linkedin") => `${BASE}/auth/${provider}`,
};

// ─── CLAIMS ───────────────────────────────────────────────────────────────────
export const claimsApi = {
  list: (params?: {
    status?: string;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortDir?: string;
  }) => api.get("/claims", { params }).then((r) => r.data),

  get: (id: string) => api.get(`/claims/${id}`).then((r) => r.data),

  create: (data: Record<string, unknown>) =>
    api.post("/claims", data).then((r) => r.data),

  createWithDocuments: (data: Record<string, unknown>, files: File[]) => {
    const fd = new FormData();
    fd.append("claimData", JSON.stringify(data));
    files.forEach((file) => fd.append("documents", file));
    return api
      .post("/claims/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },

  retry: (id: string) => api.post(`/claims/${id}/retry`).then((r) => r.data),

  documentContentUrl: (id: string, index: number) =>
    `${BASE}/claims/${id}/documents/${index}/content`,

  stream: (id: string): EventSource =>
    new EventSource(`${BASE}/claims/${id}/stream`),
};

// ─── METRICS ──────────────────────────────────────────────────────────────────
export const metricsApi = {
  get: () => api.get("/metrics").then((r) => r.data),
  agentHealth: () => api.get("/health/agents").then((r) => r.data),
};

// ─── SSE ──────────────────────────────────────────────────────────────────────
export function createGlobalEventSource(): EventSource {
  return new EventSource(`${BASE}/events`);
}

// ─── AGENT CONFIGURATION ──────────────────────────────────────────────────────
export const agentConfigApi = {
  getProviders: () => api.get("/agents/config/providers").then((r) => r.data),

  getAllConfigs: () => api.get("/agents/config").then((r) => r.data),

  getConfig: (agentName: string) =>
    api.get(`/agents/config/${agentName}`).then((r) => r.data),

  updateConfig: (agentName: string, data: Record<string, unknown>) =>
    api.put(`/agents/config/${agentName}`, data).then((r) => r.data),
};
