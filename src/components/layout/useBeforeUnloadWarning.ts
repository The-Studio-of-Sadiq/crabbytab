"use client";

import { useEffect } from "react";

/**
 * Asks the browser to confirm leaving the page while `shouldWarn` is true. Browsers show their own
 * generic message; the custom text is ignored by modern browsers.
 */
export function useBeforeUnloadWarning(shouldWarn: boolean) {
  useEffect(() => {
    if (!shouldWarn) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Required by older Chromium-based browsers to show the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [shouldWarn]);
}
