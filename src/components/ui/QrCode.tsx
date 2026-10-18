import React, { useMemo } from "react";

import { encodeQrCode, qrCodeSvgPath, type ErrorCorrectionLevel } from "@/lib/qr/qrcode";

/** A QR code rendered locally as SVG (nothing is sent to a third-party QR service). */
export function QrCode({
  value,
  label,
  size = 128,
  errorCorrectionLevel = "M",
  className,
}: {
  value: string;
  label: string;
  size?: number;
  errorCorrectionLevel?: ErrorCorrectionLevel;
  className?: string;
}) {
  const code = useMemo(() => encodeQrCode(value, errorCorrectionLevel), [value, errorCorrectionLevel]);
  const quietZone = 4;
  const dimension = code.size + quietZone * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${dimension} ${dimension}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={dimension} height={dimension} fill="#fff" />
      <path d={qrCodeSvgPath(code, quietZone)} fill="#000" />
    </svg>
  );
}
