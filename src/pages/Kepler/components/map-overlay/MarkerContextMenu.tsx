import type { KeyboardEvent } from "react";

export const MAONO_CREATE_POINT_FROM_MARKER_EVENT =
  "maono:create-point-from-marker";

export type MarkerContextMenuProps = {
  open: boolean;
  onClose: () => void;
  onRemove: () => void;
};

function PointIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
      <path d="M12 7v6M9 10h6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6" />
      <path d="M10 10v7M14 10v7" />
    </svg>
  );
}

export default function MarkerContextMenu({
  open,
  onClose,
  onRemove,
}: MarkerContextMenuProps) {
  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  function createPoint() {
    window.dispatchEvent(new CustomEvent(MAONO_CREATE_POINT_FROM_MARKER_EVENT));
    onClose();
  }

  return (
    <div
      className="maono-map-marker__menu"
      role="menu"
      aria-label="Ações do marcador"
      onKeyDown={handleKeyDown}
    >
      <button type="button" role="menuitem" onClick={createPoint}>
        <PointIcon />
        Criar ponto
      </button>
      <button type="button" role="menuitem" onClick={onRemove}>
        <TrashIcon />
        Remover marcador
      </button>
    </div>
  );
}
