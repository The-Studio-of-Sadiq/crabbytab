"use client";

import { useEffect } from "react";

export function OfflineSupport() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("Could not register offline support:", error);
    });
  }, []);

  return null;
}
