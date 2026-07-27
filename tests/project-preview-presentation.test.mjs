import assert from "node:assert/strict";
import test from "node:test";

import { resolvePreviewPresentation } from "../src/pages/Projects/components/project-preview-presentation.mjs";

function resolve(overrides = {}) {
  return resolvePreviewPresentation({
    status: "READY",
    currentUrl: "/thumbnail?v=4",
    currentRevision: 4,
    generationRevision: null,
    decodedUrl: null,
    imageError: false,
    previousReadyUrl: null,
    ...overrides,
  });
}

test("READY inicial usa carregamento neutro, nunca SVG", () => {
  assert.equal(resolve(), "loading-neutral");
});

test("READY já decodificado usa a imagem imediatamente", () => {
  assert.equal(
    resolve({ decodedUrl: "/thumbnail?v=4" }),
    "current-image",
  );
});

test("PENDING autoriza o SVG da revisão em geração", () => {
  assert.equal(
    resolve({
      status: "PENDING",
      currentUrl: null,
      generationRevision: 4,
    }),
    "generation-svg",
  );
});

test("READY da revisão observada mantém SVG até decode", () => {
  assert.equal(
    resolve({ generationRevision: 4 }),
    "generation-svg",
  );
});

test("READY decodificado encerra a apresentação de geração", () => {
  assert.equal(
    resolve({
      generationRevision: 4,
      decodedUrl: "/thumbnail?v=4",
    }),
    "current-image",
  );
});

test("UNKNOWN tenta a imagem canônica sobre fundo neutro", () => {
  assert.equal(
    resolve({ status: "UNKNOWN", currentRevision: 0 }),
    "loading-neutral",
  );
  assert.equal(
    resolve({
      status: "UNKNOWN",
      currentRevision: 0,
      decodedUrl: "/thumbnail?v=4",
    }),
    "current-image",
  );
});

test("MISSING sempre usa estado neutro", () => {
  assert.equal(
    resolve({
      status: "MISSING",
      currentUrl: null,
      previousReadyUrl: "/thumbnail?v=3",
    }),
    "missing-neutral",
  );
});

test("FAILED preserva a última revisão READY quando disponível", () => {
  assert.equal(
    resolve({
      status: "FAILED",
      currentUrl: null,
      previousReadyUrl: "/thumbnail?v=3",
    }),
    "failed-previous-image",
  );
});

test("FAILED sem imagem anterior usa estado neutro", () => {
  assert.equal(
    resolve({
      status: "FAILED",
      currentUrl: null,
    }),
    "failed-neutral",
  );
});

test("erro da nova imagem encerra o SVG e aplica fallback", () => {
  assert.equal(
    resolve({
      generationRevision: 4,
      imageError: true,
      previousReadyUrl: "/thumbnail?v=3",
    }),
    "failed-previous-image",
  );
  assert.equal(
    resolve({
      generationRevision: 4,
      imageError: true,
    }),
    "failed-neutral",
  );
});
