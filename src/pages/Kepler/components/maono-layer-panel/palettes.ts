import type {
  MapColorScale,
  MapPaletteKind,
  MapPaletteSelection,
  MapRgbColor,
} from "../../engine-adapter/types.ts";

export type MaonoPaletteId =
  | "gold"
  | "fire"
  | "ocean"
  | "royal"
  | "balance"
  | "categories";

export type MaonoPalette = MapPaletteSelection & {
  id: MaonoPaletteId;
  compatibleScales: MapColorScale[];
};

const CONTINUOUS_SCALES: MapColorScale[] = [
  "quantile",
  "quantize",
  "linear",
  "sqrt",
  "log",
];

export const MAONO_LAYER_PALETTES: MaonoPalette[] = [
  {
    id: "gold",
    label: "Dourado Maõno",
    kind: "sequential",
    compatibleScales: CONTINUOUS_SCALES,
    colors: ["#B7791F", "#D69E2E", "#E8B84A", "#F1D28A", "#F7E7B2", "#FFF8E7"],
  },
  {
    id: "fire",
    label: "Maõno Fogo",
    kind: "sequential",
    compatibleScales: CONTINUOUS_SCALES,
    colors: [
      "#FFFFCC", "#FFF2B6", "#FFE4A1", "#FFD68C", "#FFC876",
      "#FFBA61", "#FFAC4C", "#FF9D36", "#FF8F21", "#FF810C",
      "#F87100", "#E96400", "#DA5700", "#CB4A00", "#BC3D00",
      "#AD3000", "#9E2300", "#8F1600", "#800900", "#710000",
    ],
  },
  {
    id: "ocean",
    label: "Maõno Oceano",
    kind: "sequential",
    compatibleScales: CONTINUOUS_SCALES,
    colors: [
      "#F7FBFF", "#F2F8FC", "#EDF4F9", "#E7F0F6", "#E1EBF3",
      "#DBE6F0", "#D4E1ED", "#CDDBEA", "#C6D6E7", "#BFD0E3",
      "#B7CBE0", "#AFC5DC", "#A7BFD9", "#9EBAD5", "#95B4D1",
      "#8CAECD", "#81A8C9", "#75A1C4", "#6698BE", "#4A87B4",
    ],
  },
  {
    id: "royal",
    label: "Maõno Royal",
    kind: "sequential",
    compatibleScales: CONTINUOUS_SCALES,
    colors: [
      "#FCFBFD", "#F7F6FB", "#F2F1F8", "#EDEAF5", "#E7E4F1",
      "#E0DEED", "#DAD7E8", "#D3D0E4", "#CCC9DF", "#C5C1DB",
      "#BEBAD6", "#B7B1D1", "#B0A8CC", "#A89FC7", "#A096C1",
      "#988CBB", "#8F82B5", "#8376AD", "#7465A3", "#5C4795",
    ],
  },
  {
    id: "balance",
    label: "Maõno Equilíbrio",
    kind: "divergent",
    compatibleScales: ["quantile", "quantize", "linear"],
    colors: ["#315E7D", "#6E9AB5", "#D7E3E9", "#F7E7B2", "#D69E2E", "#8A4F12"],
  },
  {
    id: "categories",
    label: "Maõno Categorias",
    kind: "categorical",
    compatibleScales: ["ordinal"],
    colors: ["#C5A059", "#4A87B4", "#7465A3", "#D06B3C", "#5E8C61", "#B04A6F", "#6F7782", "#D1B36A"],
  },
];

export const DEFAULT_MAONO_PALETTE = MAONO_LAYER_PALETTES[0];

export function paletteById(id: string | null | undefined) {
  return MAONO_LAYER_PALETTES.find((palette) => palette.id === id) ?? null;
}

export function palettesForScale(scale: MapColorScale | null) {
  if (!scale) return MAONO_LAYER_PALETTES;
  return MAONO_LAYER_PALETTES.filter((palette) =>
    palette.compatibleScales.includes(scale),
  );
}

export function paletteKindLabel(kind: MapPaletteKind) {
  return kind === "categorical"
    ? "Categórica"
    : kind === "divergent"
      ? "Divergente"
      : "Sequencial";
}

export function hexToRgb(value: string): MapRgbColor {
  const normalized = value.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}
