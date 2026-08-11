export const ERROR_CATEGORIES = Object.freeze({
  AUTH: "AUTH",
  PERMISSION: "PERMISSION",
  PROJECT: "PROJECT",
  MAP_CONFIG: "MAP_CONFIG",
  STORAGE: "STORAGE",
  PERFORMANCE: "PERFORMANCE",
  SPATIAL: "SPATIAL",
  ENGINE: "ENGINE",
  INFRASTRUCTURE: "INFRASTRUCTURE",
});

export const ERROR_CATEGORY_VALUES = Object.freeze(
  Object.values(ERROR_CATEGORIES),
);

export function isErrorCategory(value) {
  return ERROR_CATEGORY_VALUES.includes(String(value || ""));
}
