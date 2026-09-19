import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_BOOT_RUNTIME_TIMEOUT_MS,
  acknowledgeInitialBootRuntime,
  completeInitialBootLoader,
  hasInitialBootLoader,
} from "../src/components/loading/initial-boot-loader.ts";

function installBootEnvironment() {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  let removed = false;
  let failures = 0;
  const fallback = { dataset: {}, remove() { removed = true; } };
  globalThis.document = {
    getElementById(id) {
      return id === "app-boot-fallback" && !removed ? fallback : null;
    },
  };
  globalThis.window = {
    __MAONO_BOOT_TIMEOUT__: globalThis.setTimeout(() => {}, 5_000),
    __MAONO_SHOW_BOOT_FAILURE__() {
      failures += 1;
      fallback.dataset.failed = "true";
    },
  };
  return {
    fallback,
    failures: () => failures,
    cleanup() {
      if (globalThis.window?.__MAONO_BOOT_TIMEOUT__) {
        globalThis.clearTimeout(globalThis.window.__MAONO_BOOT_TIMEOUT__);
      }
      if (globalThis.window?.__MAONO_BOOT_READINESS_TIMEOUT__) {
        globalThis.clearTimeout(globalThis.window.__MAONO_BOOT_READINESS_TIMEOUT__);
      }
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    },
  };
}

test("watchdog de runtime cobre a janela máxima de retry da sessão", () => {
  assert.ok(INITIAL_BOOT_RUNTIME_TIMEOUT_MS >= 30_000);
});

test("runtime substitui watchdog do bundle por watchdog de readiness", async () => {
  const env = installBootEnvironment();
  try {
    assert.equal(hasInitialBootLoader(), true);
    assert.equal(acknowledgeInitialBootRuntime(5), true);
    assert.equal(globalThis.window.__MAONO_BOOT_TIMEOUT__, undefined);
    assert.ok(globalThis.window.__MAONO_BOOT_READINESS_TIMEOUT__);
    await new Promise((resolve) => globalThis.setTimeout(resolve, 20));
    assert.equal(env.failures(), 1);
    assert.equal(env.fallback.dataset.failed, "true");
  } finally {
    env.cleanup();
  }
});

test("readiness terminal limpa watchdog e remove o fallback", async () => {
  const env = installBootEnvironment();
  try {
    assert.equal(acknowledgeInitialBootRuntime(30), true);
    assert.equal(completeInitialBootLoader(), true);
    assert.equal(hasInitialBootLoader(), false);
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    assert.equal(env.failures(), 0);
    assert.equal(globalThis.window.__MAONO_BOOT_READINESS_TIMEOUT__, undefined);
  } finally {
    env.cleanup();
  }
});
