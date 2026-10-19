"use client";

import { useEffect, useRef, useState } from "react";

interface BarcodeDetectorResult {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
}

type WindowWithBarcodeDetector = Window & {
  BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
};

/**
 * Reads Code 39 barcodes from the device camera with the browser's `BarcodeDetector` (Chrome,
 * Edge, Android). The same code seen again within 1.5 s is reported once. Attach `videoRef` to a
 * `<video>` that is rendered while `active`.
 */
export function useBarcodeCamera(options: {
  onDetected: (value: string) => void;
  onError: (message: string) => void;
}) {
  const [active, setActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Latest callbacks, so a re-render does not restart the camera.
  const callbacks = useRef(options);
  callbacks.current = options;

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let animationFrame = 0;
    let stream: MediaStream | undefined;
    let videoElement: HTMLVideoElement | null = null;
    let inFlight = false;
    let lastValue = "";
    const start = async () => {
      const Detector = (window as WindowWithBarcodeDetector).BarcodeDetector;
      if (!Detector) {
        callbacks.current.onError("Camera barcode scanning is not supported by this browser. Use a USB scanner or type the sheet id.");
        setActive(false);
        return;
      }
      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) {
          cameraStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = cameraStream;
        videoElement = videoRef.current;
        if (!videoElement) throw new Error("The camera preview is unavailable.");
        videoElement.srcObject = cameraStream;
        await videoElement.play();
        const detector = new Detector({ formats: ["code_39"] });
        const scanFrame = async () => {
          if (stopped || !videoElement || inFlight) return;
          inFlight = true;
          try {
            const value = (await detector.detect(videoElement))[0]?.rawValue.trim();
            if (value && value !== lastValue) {
              lastValue = value;
              callbacks.current.onDetected(value);
              window.setTimeout(() => { lastValue = ""; }, 1500);
            }
          } catch {
            callbacks.current.onError("Could not read a barcode from the camera stream.");
          } finally {
            inFlight = false;
            if (!stopped) animationFrame = window.requestAnimationFrame(() => void scanFrame());
          }
        };
        animationFrame = window.requestAnimationFrame(() => void scanFrame());
      } catch (error) {
        callbacks.current.onError(
          error instanceof Error ? `Camera could not be started: ${error.message}` : "Camera permission was denied."
        );
        setActive(false);
      }
    };
    void start();
    return () => {
      stopped = true;
      window.cancelAnimationFrame(animationFrame);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoElement) videoElement.srcObject = null;
    };
  }, [active]);

  return { active, setActive, videoRef };
}
