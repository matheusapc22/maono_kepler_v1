// Streaming JSON grammar, not a boundary check. Retains neither rows nor arbitrary
// string values. Limits protect CPU/stack and retained identifiers independently
// of payload size. UTF-8, escapes, numbers and every nested value are validated.
const MAX_DEPTH = 256;
const MAX_IDENTIFIERS = 100_000;
const MAX_IDENTIFIER_MEMORY_BYTES = 1024 * 1024;
const MAX_CAPTURE = 1024;
const ANALYSIS_ID = /^maono_analysis_(?:buffer|isochrone)_/;
const WS = new Set([9, 10, 13, 32]);
function invalid(field = "json") {
  return Object.assign(new Error("O MapConfig contém JSON inválido ou campos obrigatórios ausentes."), {
    status: 400, code: "INVALID_KEPLER_CONFIG", details: { field },
  });
}
function childPath(parent) {
  if (!parent) return "root";
  if (parent.type === "array") return `${parent.path}.*`;
  if (typeof parent.key !== "string" || /[.*]/.test(parent.key)) return "";
  return `${parent.path}.${parent.key}`;
}
const INTERESTING_PATHS = new Set([
  "root", "root.datasets", "root.datasets.*", "root.datasets.*.info", "root.datasets.*.data",
  "root.config", "root.config.visState", "root.config.visState.layers", "root.config.visState.layers.*",
  "root.config.visState.layers.*.config", "root.config.visState.layers.*.config.dataId", "root.config.visState.layers.*.dataId",
]);
function interestingPath(path) { return INTERESTING_PATHS.has(path); }

export class StreamingMapConfigValidator {
  constructor({ configVersion = null, datasetCount = null } = {}) {
    this.expectedVersion = configVersion;
    this.expectedDatasetCount = datasetCount;
    this.decoder = new TextDecoder("utf-8", { fatal: true });
    this.stack = [];
    this.rootStarted = false;
    this.rootDone = false;
    this.required = new Set();
    this.version = null;
    this.datasetCount = 0;
    this.available = new Set();
    this.referenced = new Set();
    this.identifierMemoryBytes = 0;
    this.token = null;
  }

  push(bytes) {
    // Validate encoding in bounded slices, including split multibyte codepoints.
    try {
      for (let i = 0; i < bytes.byteLength; i += 65536) {
        this.decoder.decode(bytes.subarray(i, i + 65536), { stream: true });
      }
    } catch { throw invalid("utf8"); }
    for (let i = 0; i < bytes.length; i += 1) {
      const b = bytes[i];
      if (this.token) {
        if (this.token.kind === "string") { this.stringByte(b); continue; }
        if (this.token.kind === "literal") {
          const token = this.token;
          if (b !== token.expected.charCodeAt(token.position++)) throw invalid();
          if (token.position === token.expected.length) {
            this.scalar(token.path, token.expected, token.expected);
            this.token = null; this.completeValue();
          }
          continue;
        }
        if (this.numberByte(b)) continue;
        this.finishNumber();
        // A delimiter ends a number; process that same byte in the grammar.
      }
      if (WS.has(b)) continue;
      const parent = this.stack.at(-1);
      if (!parent) {
        if (this.rootStarted || b !== 123) throw invalid("root");
        this.rootStarted = true;
        this.stack.push({ type: "object", path: "root", state: "keyOrEnd", key: null });
        continue;
      }
      if (parent.type === "object") {
        if (parent.state === "keyOrEnd" || parent.state === "key") {
          if (b === 125 && parent.state === "keyOrEnd") { this.closeContainer(); continue; }
          if (b !== 34) throw invalid();
          this.token = { kind: "string", key: true, path: parent.path, capture: Boolean(parent.path), text: '"', escaped: false, unicode: 0 };
          continue;
        }
        if (parent.state === "colon") {
          if (b !== 58) throw invalid();
          parent.state = "value"; continue;
        }
      }
      if (parent.state === "commaOrEnd") {
        if (b === (parent.type === "object" ? 125 : 93)) { this.closeContainer(); continue; }
        if (b !== 44) throw invalid();
        parent.state = parent.type === "object" ? "key" : "value";
        continue;
      }
      if (parent.type === "array" && parent.state === "valueOrEnd" && b === 93) { this.closeContainer(); continue; }
      if (parent.state !== "value" && parent.state !== "valueOrEnd") throw invalid();
      this.startValue(b, parent);
    }
  }

  startValue(b, parent) {
    const path = parent.path ? childPath(parent) : "";
    if (parent.path === "root.datasets") this.datasetCount += 1;
    const type = b === 123 ? "object" : b === 91 ? "array" : b === 34 ? "string" : b === 45 || (b >= 48 && b <= 57) ? "number" : "literal";
    if (parent.path === "root" && ["version", "config", "datasets"].includes(parent.key)) {
      if (this.required.has(parent.key)) throw invalid(parent.key);
      this.required.add(parent.key);
      if (parent.key === "config" && type !== "object") throw invalid("config");
      if (parent.key === "datasets" && type !== "array") throw invalid("datasets");
      if (parent.key === "version" && !["string", "number"].includes(type)) throw invalid("version");
    }
    if (type === "object" || type === "array") {
      if (this.stack.length >= MAX_DEPTH) throw invalid("depth");
      this.stack.push({ type, path: interestingPath(path) ? path : "", state: type === "object" ? "keyOrEnd" : "valueOrEnd", key: null });
    } else if (type === "string") {
      const capture = path === "root.version" || /^root\.datasets\.\*\.(?:(?:info|data)\.)?id$/.test(path) || /^root\.config\.visState\.layers\.\*\.(?:config\.)?dataId(?:\.\*)?$/.test(path);
      this.token = { kind: "string", key: false, path, capture, text: capture ? '"' : "", escaped: false, unicode: 0 };
    } else if (type === "number") {
      this.token = { kind: "number", path, state: b === 45 ? "sign" : b === 48 ? "zero" : "integer", text: String.fromCharCode(b) };
    } else {
      const expected = b === 116 ? "true" : b === 102 ? "false" : b === 110 ? "null" : null;
      if (!expected) throw invalid();
      this.token = { kind: "literal", path, expected, position: 1 };
    }
  }

  stringByte(b) {
    const token = this.token;
    if (token.capture) {
      token.text += String.fromCharCode(b);
      if (token.text.length > MAX_CAPTURE) {
        if (token.path === "root.version" || (!token.key && token.path)) throw invalid("identifier_length");
        token.capture = false; token.text = "";
      }
    }
    if (token.unicode) {
      if (!((b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102))) throw invalid();
      token.unicode -= 1; return;
    }
    if (token.escaped) {
      token.escaped = false;
      if (b === 117) { token.unicode = 4; return; }
      if (![34, 92, 47, 98, 102, 110, 114, 116].includes(b)) throw invalid();
      return;
    }
    if (b === 92) { token.escaped = true; return; }
    if (b < 32) throw invalid();
    if (b !== 34) return;
    let value = null;
    if (token.capture) {
      // text contains only a bounded token, never the document or a dataset row.
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(token.text, c => c.charCodeAt(0))));
      } catch { throw invalid(); }
    }
    this.token = null;
    if (token.key) {
      const parent = this.stack.at(-1);
      parent.key = value; parent.state = "colon";
    } else {
      this.scalar(token.path, "string", value); this.completeValue();
    }
  }

  numberByte(b) {
    const token = this.token;
    const digit = b >= 48 && b <= 57;
    let next = null;
    if (token.state === "sign") next = b === 48 ? "zero" : digit && b !== 48 ? "integer" : null;
    else if (token.state === "integer") next = digit ? "integer" : b === 46 ? "dot" : b === 101 || b === 69 ? "exponent" : null;
    else if (token.state === "zero") next = b === 46 ? "dot" : b === 101 || b === 69 ? "exponent" : null;
    else if (token.state === "dot") next = digit ? "fraction" : null;
    else if (token.state === "fraction") next = digit ? "fraction" : b === 101 || b === 69 ? "exponent" : null;
    else if (token.state === "exponent") next = b === 43 || b === 45 ? "exponentSign" : digit ? "exponentDigits" : null;
    else if (token.state === "exponentSign" || token.state === "exponentDigits") next = digit ? "exponentDigits" : null;
    if (!next) return false;
    token.state = next;
    if (token.path === "root.version") {
      token.text += String.fromCharCode(b);
      if (token.text.length > 80) throw invalid("version");
    }
    return true;
  }

  finishNumber() {
    if (!["zero", "integer", "fraction", "exponentDigits"].includes(this.token.state)) throw invalid();
    this.scalar(this.token.path, "number", this.token.text);
    this.token = null; this.completeValue();
  }

  scalar(path, type, value) {
    if (path === "root.version") {
      if ((type !== "string" && type !== "number") || !value || (type === "number" && !Number(value))) throw invalid("version");
      this.version = String(value);
    }
    if (type !== "string" || !value) return;
    if (/^root\.datasets\.\*\.(?:(?:info|data)\.)?id$/.test(path)) {
      const dataset = this.stack.find(frame => frame.path === "root.datasets.*");
      if (dataset) {
        const rank = path.includes(".info.") ? 0 : path.includes(".data.") ? 1 : 2;
        dataset.ids ??= [];
        dataset.ids[rank] = value.trim();
      }
    } else if (path.startsWith("root.config.visState.layers.") && ANALYSIS_ID.test(value.trim())) {
      this.addIdentifier(this.referenced, value.trim());
    }
  }

  addIdentifier(target, value) {
    if (target.has(value)) return;
    this.identifierMemoryBytes += value.length * 2;
    if (target.size >= MAX_IDENTIFIERS || this.identifierMemoryBytes > MAX_IDENTIFIER_MEMORY_BYTES) throw invalid("identifier_budget");
    target.add(value);
  }

  completeValue() {
    const parent = this.stack.at(-1);
    if (!parent) { this.rootDone = true; return; }
    parent.state = "commaOrEnd";
  }
  closeContainer() {
    const closed = this.stack.pop();
    if (closed.path === "root.datasets.*") {
      const id = closed.ids?.find(Boolean);
      if (id && ANALYSIS_ID.test(id)) {
        this.addIdentifier(this.available, id);
      }
    }
    this.completeValue();
  }

  finish() {
    try { this.decoder.decode(); } catch { throw invalid("utf8"); }
    if (this.token?.kind === "number") this.finishNumber();
    if (this.token || this.stack.length || !this.rootDone || this.required.size !== 3 || !this.version) throw invalid();
    if (this.expectedVersion != null && String(this.expectedVersion) !== this.version) throw invalid("version");
    if (this.expectedDatasetCount != null && Number(this.expectedDatasetCount) !== this.datasetCount) throw invalid("datasets");
    for (const id of this.referenced) {
      if (!this.available.has(id)) {
        throw Object.assign(new Error("A configuração contém uma camada de análise sem o dataset correspondente."), {
          status: 400, code: "PROJECT_CONFIG_ANALYSIS_DATASET_MISSING",
        });
      }
    }
    return { configVersion: this.version, datasetCount: this.datasetCount };
  }
}
