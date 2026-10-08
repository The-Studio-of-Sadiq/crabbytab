"use client";

import { useEffect } from "react";

export function OfflineSupport() {
  useEffect(() => {
    const reloadForChunkError = (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      if (!message.includes("ChunkLoadError") && !/Loading chunk \d+ failed/i.test(message)) return;

      const reloadKey = "crabbytab:chunk-reload";
      const now = Date.now();
      try {
        const previousReload = Number(sessionStorage.getItem(reloadKey));
        if (previousReload && now - previousReload < 30_000) return;
        sessionStorage.setItem(reloadKey, String(now));
      } catch {
        return;
      }
      window.location.reload();
    };

    const handleError = (event: ErrorEvent) => reloadForChunkError(event.error ?? event.message);
    const handleRejection = (event: PromiseRejectionEvent) => reloadForChunkError(event.reason);
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
        console.error("Could not register offline support:", error);
      });
    }

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
