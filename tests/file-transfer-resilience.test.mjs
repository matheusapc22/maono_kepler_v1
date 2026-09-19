import assert from "node:assert/strict";
import test from "node:test";
import {
  FILE_TRANSFER_TIMEOUT_MS,
  uploadOrganizationFileWithProgress,
  downloadOrganizationFileWithProgress,
} from "../src/lib/file-transfer.ts";

class ControlledXhr {
  static requests = [];
  upload = {};
  headers = {};
  status = 0;
  constructor() { ControlledXhr.requests.push(this); }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.headers[name] = value; }
  getResponseHeader(name) { return this.headers[name] || null; }
  send(body) { this.body = body; }
}

function withXhr(t) {
  ControlledXhr.requests = [];
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = ControlledXhr;
  t.after(() => { globalThis.XMLHttpRequest = original; });
}

test("upload e download que excedem prazo encerram com erro seguro, sem replay automático", async (t) => {
  withXhr(t);
  const upload = uploadOrganizationFileWithProgress(1, new FormData());
  const uploadXhr = ControlledXhr.requests[0];
  assert.equal(uploadXhr.timeout, FILE_TRANSFER_TIMEOUT_MS);
  const uploadRejected = assert.rejects(upload, (error) => {
    assert.equal(error.code, "PERFORMANCE_OPERATION_TIMEOUT");
    assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /XMLHttpRequest|timeout|Dropbox/i);
    return true;
  });
  uploadXhr.ontimeout();
  await uploadRejected;

  const download = downloadOrganizationFileWithProgress(1, 2);
  const downloadXhr = ControlledXhr.requests[1];
  assert.equal(downloadXhr.timeout, FILE_TRANSFER_TIMEOUT_MS);
  const downloadRejected = assert.rejects(download, { code: "PERFORMANCE_OPERATION_TIMEOUT" });
  downloadXhr.ontimeout();
  await downloadRejected;
  assert.equal(ControlledXhr.requests.length, 2);
});

test("prazo customizado permanece finito e limitado", async (t) => {
  withXhr(t);
  for (const [value, expected] of [[Infinity, 300000], [0, 1000], [1200000, 900000], [450000, 450000]]) {
    const promise = uploadOrganizationFileWithProgress(1, new FormData(), undefined, { timeoutMs: value });
    const xhr = ControlledXhr.requests.at(-1);
    assert.equal(xhr.timeout, expected);
    const rejected = assert.rejects(promise, { code: "PERFORMANCE_OPERATION_TIMEOUT" });
    xhr.ontimeout();
    await rejected;
  }
});

test("download conclui com filename alternativo quando cabeçalho UTF-8 é inválido", async (t) => {
  withXhr(t);
  const promise = downloadOrganizationFileWithProgress(1, 2);
  const xhr = ControlledXhr.requests[0];
  xhr.status = 200;
  xhr.response = new Blob(["conteúdo"], { type: "text/plain" });
  xhr.headers["Content-Disposition"] = 'attachment; filename="relatorio.txt"; filename*=UTF-8\'\'bad%ZZ';
  await xhr.onload();
  const result = await promise;
  assert.equal(result.fileName, "relatorio.txt");
  assert.equal(await result.blob.text(), "conteúdo");
});
