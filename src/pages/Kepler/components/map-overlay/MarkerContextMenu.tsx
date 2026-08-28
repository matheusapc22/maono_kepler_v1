import type { KeyboardEvent } from "react";

export type MarkerContextMenuProps = {
  open: boolean;
  onClose: () => void;
  onRemove: () => void;
};

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

  return (
    <div
      className="maono-map-marker__menu"
      role="menu"
      aria-label="Ações do marcador"
      onKeyDown={handleKeyDown}
    >
      <button type="button" role="menuitem" onClick={onRemove}>
        <TrashIcon />
        Remover marcador
      </button>
    </div>
  );
}
