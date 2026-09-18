import type { HTMLAttributes } from "react";

import { UniversalLoader, type UniversalLoaderSize } from "./UniversalLoader";

export type LoadingOverlayScope = "viewport" | "container";

type LoadingOverlayProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  active: boolean;
  scope?: LoadingOverlayScope;
  loaderSize?: UniversalLoaderSize;
  accessibleLabel?: string;
};

export function LoadingOverlay({
  active,
  scope = "viewport",
  loaderSize = "page",
  accessibleLabel = "Carregando",
  className = "",
  ...props
}: LoadingOverlayProps) {
  if (!active) {
    return null;
  }

  return (
    <div
      className={`mm-loading-overlay mm-loading-overlay--${scope} ${className}`.trim()}
      aria-busy="true"
      {...props}
    >
      <UniversalLoader
        size={loaderSize}
        accessibleLabel={accessibleLabel}
      />
    </div>
  );
}
