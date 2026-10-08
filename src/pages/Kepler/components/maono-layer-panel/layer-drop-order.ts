export type LayerDropPosition = "before" | "after";

/** The midpoint belongs to the lower half; coordinates are viewport-relative. */
export function layerDropPosition(
  pointerY: number,
  row: { top: number; height: number },
): LayerDropPosition {
  return pointerY < row.top + row.height / 2 ? "before" : "after";
}

/** Produce the complete native layer order, or null for invalid/no-op drops. */
export function reorderLayerIdsAtTarget(
  layerIds: readonly string[],
  draggedLayerId: string,
  targetLayerId: string,
  position: LayerDropPosition,
): string[] | null {
  if (draggedLayerId === targetLayerId || !layerIds.includes(draggedLayerId) || !layerIds.includes(targetLayerId)) {
    return null;
  }

  // Locate the target after removal: downward moves must not inherit a shifted index.
  const order = layerIds.filter((id) => id !== draggedLayerId);
  const insertionIndex = order.indexOf(targetLayerId) + (position === "after" ? 1 : 0);
  order.splice(insertionIndex, 0, draggedLayerId);
  return order.every((id, index) => id === layerIds[index]) ? null : order;
}
