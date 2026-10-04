type AnchorRect = { left: number; right: number; top: number; bottom: number };

/** Keep the portaled panel independent of the sidebar and inside the viewport. */
export function organizationMenuPosition(
  rect: AnchorRect,
  viewport: { width: number; height: number },
  expanded: boolean,
  contentHeight: number,
) {
  const margin = 8;
  const width = Math.max(0, Math.min(340, viewport.width - margin * 2));
  const preferredLeft = expanded ? rect.left + 12 : rect.right + margin;
  const left = Math.max(margin, Math.min(preferredLeft, viewport.width - width - margin));
  const below = Math.max(0, viewport.height - rect.bottom - margin * 2);
  const above = Math.max(0, rect.top - margin * 2);
  const height = Math.min(contentHeight, viewport.height - margin * 2);
  const flipped = expanded && below < height && above > below;
  const available = expanded ? (flipped ? above : below) : viewport.height - rect.top - margin;
  // Very short screens need the available viewport, rather than an unusable sliver.
  const maxHeight = Math.max(0, available < 200 ? viewport.height - margin * 2 : available);
  const top = Math.max(margin, Math.min(
    expanded ? (flipped ? rect.top - margin - Math.min(height, maxHeight) : rect.bottom + margin) : rect.top,
    viewport.height - Math.min(height, maxHeight) - margin,
  ));
  return { left, top, width, maxHeight };
}
