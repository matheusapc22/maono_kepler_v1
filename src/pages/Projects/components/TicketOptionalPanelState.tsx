import TicketErrorNotice from "./TicketErrorNotice";
import type { TicketApiError } from "./tickets-api";
import "./ticket-optional-panel-state.css";

/** Availability is server-owned. Unknown/disabled modules have no ready UI. */
export default function TicketOptionalPanelState({ title, error, onRetry, onRefresh }: {
  title: string;
  error: TicketApiError | null;
  onRetry: () => void;
  onRefresh?: () => void;
}) {
  if (!error) return null;
  return <section className="ticket-optional-panel-error" aria-label={title}>
    <h3>{title}</h3>
    <TicketErrorNotice error={error} onRetry={onRetry} />
    {onRefresh ? <button type="button" onClick={onRefresh}>Consultar estado atual</button> : null}
  </section>;
}
