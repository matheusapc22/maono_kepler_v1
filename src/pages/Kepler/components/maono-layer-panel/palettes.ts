export type MaonoPalette = {
  id: "fire" | "ocean" | "royal";
  label: string;
  colors: Array<[number, number, number]>;
};

export const MAONO_LAYER_PALETTES: MaonoPalette[] = [
  {
    id: "fire",
    label: "Fogo",
    colors: [
      [255, 196, 61],
      [249, 115, 22],
      [190, 24, 93],
    ],
  },
  {
    id: "ocean",
    label: "Oceano",
    colors: [
      [34, 211, 238],
      [47, 125, 244],
      [30, 58, 138],
    ],
  },
  {
    id: "royal",
    label: "Royal",
    colors: [
      [196, 181, 253],
      [124, 58, 237],
      [76, 29, 149],
    ],
  },
];
