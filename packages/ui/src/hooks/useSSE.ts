import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createGlobalEventSource } from "../api";
import { useAppStore } from "../store";
import { ClaimLog } from "../types";

export function useGlobalSSE() {
  const qc = useQueryClient();
  const { setSseConnected, addLiveLog } = useAppStore();
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    console.log("[SSE Hook] Initializing...");

    function connect() {
      const BASE = import.meta.env.VITE_API_URL || "/api";
      const eventUrl = `${BASE}/events`;
      console.log(`[SSE Hook] Connecting to: ${eventUrl}`);

      if (esRef.current) esRef.current.close();

      const es = createGlobalEventSource();
      esRef.current = es;

      console.log(
        `[SSE Hook] EventSource created, readyState: ${es.readyState}`,
      );

      es.addEventListener("open", () => {
        setSseConnected(true);
        console.log("[SSE] Connected (open event)");
      });

      // Handle initial connection event
      es.addEventListener("connected", () => {
        setSseConnected(true);
        console.log("[SSE] Connected (connected event)");
      });

      es.addEventListener("message", (e) => {
        console.log("[SSE] Message received:", e.data?.substring(0, 100));
        try {
          const log = JSON.parse(e.data) as ClaimLog;
          addLiveLog(log);

          // Invalidate relevant queries
          if (log.claimId) {
            qc.invalidateQueries({ queryKey: ["claim", log.claimId] });
            qc.invalidateQueries({ queryKey: ["claims"] });
          }
        } catch (err) {
          console.error("[SSE] Failed to parse message:", e.data, err);
        }
      });

      es.addEventListener("error", (evt) => {
        setSseConnected(false);
        console.error(
          "[SSE] Error event:",
          evt.type,
          "readyState:",
          es.readyState,
        );
        es.close();
        esRef.current = null;
        retryRef.current = setTimeout(connect, 5000);
      });
    }

    connect();
    return () => {
      console.log("[SSE Hook] Cleaning up");
      esRef.current?.close();
      clearTimeout(retryRef.current);
    };
  }, [setSseConnected, addLiveLog, qc]);
}

export function useClaimStream(
  claimId: string,
  onLog: (log: ClaimLog) => void,
  onComplete?: (status: string) => void,
) {
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!claimId) return;

    const BASE = import.meta.env.VITE_API_URL || "/api";
    const es = new EventSource(`${BASE}/claims/${claimId}/stream`);
    esRef.current = es;

    es.addEventListener("message", (e) => {
      try {
        onLog(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("complete", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        onComplete?.(data.status);
      } catch {
        /* ignore */
      }
      es.close();
    });

    es.addEventListener("error", () => es.close());

    return () => es.close();
  }, [claimId]);

  return () => esRef.current?.close();
}
