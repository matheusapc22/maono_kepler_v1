import assert from "node:assert/strict";
import test from "node:test";

import { createCachedModuleLoader } from "../src/navigation/route-module-loader.ts";
import { PreparedNavigationIntentController } from "../src/navigation/prepared-navigation-controller.ts";

test("route module loader deduplica imports concorrentes", async () => {
  let calls = 0;
  let resolveImport;
  const loader = createCachedModuleLoader(() => {
    calls += 1;
    return new Promise((resolve) => {
      resolveImport = resolve;
    });
  });

  const first = loader();
  const second = loader();

  assert.equal(first, second);
  assert.equal(calls, 0);

  await Promise.resolve();
  assert.equal(calls, 1);

  resolveImport({ default: "ok" });
  assert.deepEqual(await first, { default: "ok" });
  assert.deepEqual(await second, { default: "ok" });
});

test("route module loader invalida cache após falha", async () => {
  let attempts = 0;
  const loader = createCachedModuleLoader(async () => {
    attempts += 1;

    if (attempts === 1) {
      throw new Error("chunk indisponível");
    }

    return { default: "recuperado" };
  });

  await assert.rejects(loader(), /chunk indisponível/);
  assert.deepEqual(await loader(), { default: "recuperado" });
  assert.equal(attempts, 2);
});

test("somente a intenção de navegação mais recente permanece válida", () => {
  const controller = new PreparedNavigationIntentController();
  const first = controller.begin();
  const second = controller.begin();

  assert.equal(controller.isCurrent(first), false);
  assert.equal(controller.isCurrent(second), true);

  controller.cancel();
  assert.equal(controller.isCurrent(second), false);
});
