// Reverse only the shared-control import and JSX tag migration. Domain logic,
// props, event handlers and option values remain subject to their existing gates.
export function restoreMaonoSelect(source) {
  return source.replace(/^import \{ MaonoSelect \} from "(?:\.\.\/|\.\/)+components\/selection\/MaonoSelect";\n/m, "")
    .replace(/^import \{ MaonoSelect \} from "\.\.\/selection\/MaonoSelect";\n/m, "")
    .replace(/<MaonoSelect\b/g, "<select").replace(/<\/MaonoSelect>/g, "</select>");
}
