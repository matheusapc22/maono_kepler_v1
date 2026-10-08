import ts from "typescript";

// Reverse only the shared-control import and JSX tag migration. Domain logic,
// props, event handlers and option values remain subject to their existing gates.
export function restoreMaonoSelect(source) {
  return source.replace(/^import \{ MaonoSelect \} from "(?:\.\.\/|\.\/)+components\/selection\/MaonoSelect";\n/m, "")
    .replace(/^import \{ MaonoSelect \} from "\.\.\/selection\/MaonoSelect";\n/m, "")
    .replace(/<MaonoSelect\b/g, "<select").replace(/<\/MaonoSelect>/g, "</select>");
}

// Independent presentation-boundary fingerprint: option values, disabled rules,
// bindings and event handlers of every actual MaonoSelect remain byte-exact.
export function maonoSelectDeclarations(source) {
  const ast = ts.createSourceFile('consumer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'MaonoSelect') declarations.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return declarations.join('\n');
}
