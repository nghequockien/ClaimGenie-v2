import { create } from 'zustand';
import { ClaimLog, AgentName } from '../types';

interface LiveLog extends ClaimLog {
  claimNumber?: string;
}

interface AppStore {
  // SSE connection
  sseConnected: boolean;
  setSseConnected: (v: boolean) => void;

  // Live logs feed for monitoring
  liveLogs: LiveLog[];
  addLiveLog: (log: LiveLog) => void;
  clearLogs: () => void;

  // Agent health
  agentHealth: Record<string, { status: string; port: number }>;
  setAgentHealth: (health: Record<string, { status: string; port: number }>) => void;

  // Selected claim for detail view
  selectedClaimId: string | null;
  setSelectedClaimId: (id: string | null) => void;

  // Log filter
  logFilter: { level: string; agent: AgentName | 'ALL'; search: string };
  setLogFilter: (f: Partial<AppStore['logFilter']>) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  sseConnected: false,
  setSseConnected: (v) => set({ sseConnected: v }),

  liveLogs: [],
  addLiveLog: (log) =>
    set((s) => ({
      liveLogs: [log, ...s.liveLogs].slice(0, 1000), // keep last 1000
    })),
  clearLogs: () => set({ liveLogs: [] }),

  agentHealth: {},
  setAgentHealth: (health) => set({ agentHealth: health }),

  selectedClaimId: null,
  setSelectedClaimId: (id) => set({ selectedClaimId: id }),

  logFilter: { level: 'ALL', agent: 'ALL', search: '' },
  setLogFilter: (f) => set((s) => ({ logFilter: { ...s.logFilter, ...f } })),
}));
