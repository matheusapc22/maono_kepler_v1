import type { CSSProperties } from "react";

import type { MaonoFilterSnapshot } from "../../integration/keplerBridge.ts";
import LayerPanelIcon from "./LayerPanelIcon.tsx";
import PanelActionMenu, { type PanelActionMenuItem } from "./PanelActionMenu.tsx";
import {
  filterTypeLabel,
  filterValueLabel,
} from "./filters/filter-utils.ts";

type Props = {
  filter: MaonoFilterSnapshot;
  accent: string;
  editable: boolean;
  onOpen: (filter: MaonoFilterSnapshot) => void;
  onToggle: (filter: MaonoFilterSnapshot, enabled: boolean) => void;
  onRemove: (filter: MaonoFilterSnapshot) => void;
};

export default function FilterRow({
  filter,
  accent,
  editable,
  onOpen,
  onToggle,
  onRemove,
}: Props) {
  const fieldName = filter.fieldNames[0] ?? `Filtro ${filter.index + 1}`;
  const items: PanelActionMenuItem[] = [];

  if (editable && filter.compatible) {
    items.push({
      label: filter.enabled ? "Desativar filtro" : "Ativar filtro",
      icon: filter.enabled ? "eye-off" : "eye",
      onSelect: () => onToggle(filter, !filter.enabled),
    });
  }
  if (editable) {
    items.push({
      label: "Remover filtro",
      icon: "trash",
      danger: true,
      separatorBefore: items.length > 0,
      onSelect: () => onRemove(filter),
    });
  }

  return (
    <article
      className={`maono-filter-row${filter.enabled ? "" : " is-disabled"}${filter.compatible ? "" : " is-incompatible"}`}
      style={{ "--maono-filter-accent": accent } as CSSProperties}
    >
      <span className="maono-filter-row__accent" aria-hidden="true" />
      <button
        type="button"
        className="maono-filter-row__open"
        onClick={() => onOpen(filter)}
      >
        <strong>{fieldName}</strong>
        <small>{filterValueLabel(filter)}</small>
        <em>
          {filter.compatible
            ? filterTypeLabel(filter.type)
            : "Configuração preservada"}
        </em>
      </button>
      {!filter.enabled ? (
        <span className="maono-filter-row__state" title="Filtro inativo">
          <LayerPanelIcon name="eye-off" />
        </span>
      ) : null}
      {items.length ? (
        <PanelActionMenu label={`Ações de ${fieldName}`} items={items} />
      ) : null}
    </article>
  );
}
