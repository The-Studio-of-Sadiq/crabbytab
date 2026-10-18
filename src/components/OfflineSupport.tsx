"use client";

import { useEffect } from "react";
import { claimChunkReload, isChunkLoadError } from "@/lib/offline/chunkRecovery";

export function OfflineSupport() {
  useEffect(() => {
    const reloadForChunkError = (...sources: unknown[]) => {
      if (!isChunkLoadError(...sources)) return;
      let storage: Storage | undefined;
      try {
        storage = window.sessionStorage;
      } catch {
        storage = undefined;
      }
      if (claimChunkReload(storage, Date.now())) window.location.reload();
    };

    // The failure can be described on the error object, in the event message, or both.
    const handleError = (event: ErrorEvent) => reloadForChunkError(event.error, event.message);
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
