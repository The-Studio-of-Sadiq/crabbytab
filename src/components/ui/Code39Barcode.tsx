import { encodeCode39, supportsCode39 } from "@/lib/checkins/code39";

export function Code39Barcode({ value, label }: { value: string; label: string }) {
  if (!supportsCode39(value)) {
    return <span className="font-mono text-xs">No Code 39 barcode available for this ID.</span>;
  }
  const elements = encodeCode39(value);
  const width = elements.reduce((total, element) => total + element.width, 0);
  let x = 0;

  return (
    <svg
      viewBox={`0 0 ${width} 36`}
      role="img"
      aria-label={`${label} barcode ${value}`}
      className="h-10 w-full max-w-[280px]"
      preserveAspectRatio="none"
    >
      {elements.map((element, index) => {
        const start = x;
        x += element.width;
        return element.bar ? (
          <rect key={index} x={start} y="0" width={element.width} height="30" fill="currentColor" />
        ) : null;
      })}
      <text x={width / 2} y="35" textAnchor="middle" fontSize="4" fill="currentColor">
        {value.toUpperCase()}
      </text>
    </svg>
  );
}
