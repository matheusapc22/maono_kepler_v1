import { useState } from "react";

/** The keyed panel owns only cancellation; the Central owns the single clock. */
export function useTicketOptionalPresentation({ structurePending, stagePending, error }: {
  structurePending: boolean;
  stagePending: boolean;
  error: unknown;
}) {
  const [cancelled, setCancelled] = useState(false);
  // A terminal error cancels the first visual hold for this mounted context.
  // Clearing that error for a retry must never revive the remaining delay.
  if (error && !cancelled) setCancelled(true);
  return {
    structurePending: structurePending && !cancelled && !error,
    stagePending: stagePending && !cancelled && !error,
  };
}
