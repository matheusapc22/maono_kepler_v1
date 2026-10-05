import { useId, type ReactNode } from "react";
import "./map-error-notice.css";

type MapErrorNoticeProps = {
  title: string;
  message: string;
  supportReference?: string;
  children: ReactNode;
};

/** Shared presentation only. Callers retain error policy, access and actions. */
export default function MapErrorNotice({
  title,
  message,
  supportReference,
  children,
}: MapErrorNoticeProps) {
  const titleId = useId();
  const messageId = useId();

  return (
    <div className="maono-map-notice" role="alert" aria-labelledby={titleId} aria-describedby={messageId}>
      <div className="maono-map-notice__heading">
        <span className="maono-map-notice__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.3 4.7 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.7a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v5m0 3h.01" />
          </svg>
        </span>
        <div>
          <span className="maono-map-notice__eyebrow">Aviso do mapa</span>
          <h2 id={titleId}>{title}</h2>
        </div>
      </div>
      <p id={messageId} className="maono-map-notice__message">{message}</p>
      {supportReference ? <p className="maono-map-notice__reference">Referência: {supportReference}</p> : null}
      <div className="maono-map-notice__actions">{children}</div>
    </div>
  );
}
