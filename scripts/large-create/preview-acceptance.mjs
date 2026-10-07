import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// A Preview hostname does not prove isolated D1/Dropbox bindings. This old
// cookie-based runner has no audited binding gate or guaranteed cleanup and
// therefore must never perform even its first remote request.
export function main() {
  throw Object.assign(new Error(
    "Preview acceptance retired: bindings may share Production. Use the registered " +
    "durable-project-save suite through production-acceptance-operator.yml after " +
    "read-only binding audit, separate Worker deployment approval, preflight and " +
    "the protected human-approved acceptance window. This runner performs no requests.",
  ), { code: "PREVIEW_ACCEPTANCE_RETIRED" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
