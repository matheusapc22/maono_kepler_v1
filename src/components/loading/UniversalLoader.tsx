import type { HTMLAttributes } from "react";

export type UniversalLoaderSize = "inline" | "compact" | "page";

type UniversalLoaderProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  size?: UniversalLoaderSize;
  accessibleLabel?: string;
};

export function UniversalLoader({
  size = "page",
  accessibleLabel = "Carregando",
  className = "",
  ...props
}: UniversalLoaderProps) {
  return (
    <span
      className={`mm-universal-loader mm-universal-loader--${size} ${className}`.trim()}
      role="status"
      aria-live="polite"
      {...props}
    >
      <span className="mm-universal-loader__ring" aria-hidden="true" />
      <span className="mm-sr-only">{accessibleLabel}</span>
    </span>
  );
}
