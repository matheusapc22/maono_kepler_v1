import assert from "node:assert/strict";
import test from "node:test";

import { LoadingController } from "../src/components/loading/loading-controller.ts";
import {
  LoadingStaleObserver,
  buildLoadingStaleDiagnostic,
} from "../src/components/loading/loading-diagnostics.ts";

test("stale emite uma vez e nunca encerra token", async () => {
  const controller = new LoadingController();
  const diagnostics = [];
  const observer = new LoadingStaleObserver(controller, {
    staleAfterMs: 5,
    onStale: (diagnostic) => diagnostics.push(diagnostic),
  });

  observer.start();
  const token = controller.begin({
    label: "map-hydration",
    scope: "map",
    surface: "handoff",
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].event, "loading_token_stale");
  assert.equal(diagnostics[0].label, "map-hydration");
  assert.equal(controller.activeCount, 1);

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(diagnostics.length, 1);
  assert.equal(controller.activeCount, 1);

  controller.end(token);
  observer.stop();
});

test("token encerrado antes do budget não gera diagnóstico", async () => {
  const controller = new LoadingController();
  const diagnostics = [];
  const observer = new LoadingStaleObserver(controller, {
    staleAfterMs: 30,
    onStale: (diagnostic) => diagnostics.push(diagnostic),
  });

  observer.start();
  const token = controller.begin({
    label: "auth-login",
    scope: "auth",
    surface: "viewport",
  });
  controller.end(token);

  await new Promise((resolve) => setTimeout(resolve, 40));
  observer.stop();

  assert.deepEqual(diagnostics, []);
});

test("payload stale deriva somente da allowlist segura", () => {
  const diagnostic = buildLoadingStaleDiagnostic({
    id: 7,
    label: "prepared-navigation",
    scope: "navigation",
    surface: "handoff",
    createdAt: 100,
    ageMs: 321.4,
  });

  assert.deepEqual(Object.keys(diagnostic).sort(), [
    "ageMs",
    "event",
    "label",
    "scope",
    "surface",
    "tokenId",
  ]);
  assert.equal(diagnostic.ageMs, 321);
});
