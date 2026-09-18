import assert from "node:assert/strict";
import test from "node:test";

import { LoadingController } from "../src/components/loading/loading-controller.ts";

test("controller mantém loading ativo até todas as operações terminarem", () => {
  const controller = new LoadingController();
  const first = controller.begin();
  const second = controller.begin();

  assert.equal(controller.activeCount, 2);
  assert.equal(controller.isLoading, true);

  controller.end(first);
  assert.equal(controller.activeCount, 1);
  assert.equal(controller.isLoading, true);

  controller.end(second);
  assert.equal(controller.activeCount, 0);
  assert.equal(controller.isLoading, false);
});

test("end é idempotente para um mesmo token", () => {
  const controller = new LoadingController();
  const token = controller.begin();

  controller.end(token);
  controller.end(token);

  assert.equal(controller.activeCount, 0);
});

test("withLoading sempre libera o token após sucesso", async () => {
  const controller = new LoadingController();
  const result = await controller.withLoading(async () => "ok");

  assert.equal(result, "ok");
  assert.equal(controller.activeCount, 0);
});

test("withLoading sempre libera o token após erro", async () => {
  const controller = new LoadingController();

  await assert.rejects(
    controller.withLoading(async () => {
      throw new Error("falha esperada");
    }),
    /falha esperada/,
  );

  assert.equal(controller.activeCount, 0);
  assert.equal(controller.isLoading, false);
});

test("subscribe observa mudanças reais de concorrência", () => {
  const controller = new LoadingController();
  const snapshots = [];
  const unsubscribe = controller.subscribe((count) => snapshots.push(count));

  const first = controller.begin();
  const second = controller.begin();
  controller.end(first);
  controller.end(second);
  unsubscribe();

  assert.deepEqual(snapshots, [0, 1, 2, 1, 0]);
});
