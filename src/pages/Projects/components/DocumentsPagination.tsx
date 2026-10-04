import { MaonoSelect } from "../../../components/selection/MaonoSelect";
import type { ReactNode } from "react";
import "./DocumentsSection.css";
import { DocumentIcon } from "./DocumentsUi";

/** Shared presentation; each workspace retains its own backend paging controller. */
export default function DocumentsPagination({ status, page, pageSize, canGoPrevious, canGoNext, disabled, disablePageSize = false, onPageSize, onPrevious, onNext }: {
  status: ReactNode; page: number; pageSize: number; canGoPrevious: boolean; canGoNext: boolean;
  disabled: boolean; disablePageSize?: boolean;
  onPageSize: (size: number) => void; onPrevious: () => void; onNext: () => void;
}) {
  return <div className="mm-docs-pagination">
    <span role="status">{status}</span>
    <div className="mm-docs-page-controls">
      <label>Itens por página <MaonoSelect value={pageSize} disabled={disablePageSize} onChange={event => onPageSize(Number(event.target.value))}>
        <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
      </MaonoSelect></label>
      <button type="button" className="mm-docs-page-arrow is-previous" aria-label="Página anterior" disabled={!canGoPrevious || disabled} onClick={onPrevious}><DocumentIcon name="chevron" /></button>
      <span className="mm-docs-page-number" aria-current="page">{page}</span>
      <button type="button" className="mm-docs-page-arrow" aria-label="Próxima página" disabled={!canGoNext || disabled} onClick={onNext}><DocumentIcon name="chevron" /></button>
    </div>
  </div>;
}
