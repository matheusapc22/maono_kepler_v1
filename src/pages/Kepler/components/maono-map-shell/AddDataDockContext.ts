import { createContext } from "react";

// The outlet changes presentation only. Kepler keeps ownership of import
// actions, progress, notifications and async completion in its Redux state.
export const AddDataDockContext = createContext<{
  target: HTMLDivElement | null;
  enabled: boolean;
  close: () => void;
} | null>(null);
