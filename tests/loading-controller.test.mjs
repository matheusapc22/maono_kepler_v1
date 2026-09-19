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


test("tokens pertencem à instância que os criou", () => {
  const firstController = new LoadingController();
  const secondController = new LoadingController();
  const firstToken = firstController.begin();
  const secondToken = secondController.begin();

  assert.equal(firstToken.id, 1);
  assert.equal(secondToken.id, 1);
  assert.notEqual(firstToken.owner, secondToken.owner);
  assert.equal(firstController.owns(firstToken), true);
  assert.equal(firstController.owns(secondToken), false);
  assert.equal(firstController.end(secondToken), false);
  assert.equal(firstController.activeCount, 1);

  assert.equal(firstController.end(firstToken), true);
  assert.equal(firstController.activeCount, 0);
  assert.equal(secondController.activeCount, 1);
  secondController.end(secondToken);
});

test("clear encerra toda a geração atual sem afetar outro controller", () => {
  const firstController = new LoadingController();
  const secondController = new LoadingController();
  firstController.begin();
  firstController.begin();
  secondController.begin();

  firstController.clear();

  assert.equal(firstController.activeCount, 0);
  assert.equal(secondController.activeCount, 1);
});


test("metadata segura acompanha token e snapshot ativo", () => {
  const controller = new LoadingController();
  const token = controller.begin(
    {
      label: "prepared-navigation",
      scope: "navigation",
      surface: "handoff",
    },
    1_000,
  );

  assert.deepEqual(token.metadata, {
    label: "prepared-navigation",
    scope: "navigation",
    surface: "handoff",
    createdAt: 1_000,
  });

  assert.deepEqual(controller.getActiveSnapshot(1_250), [
    {
      id: token.id,
      label: "prepared-navigation",
      scope: "navigation",
      surface: "handoff",
      createdAt: 1_000,
      ageMs: 250,
    },
  ]);

  controller.end(token);
  assert.deepEqual(controller.getActiveSnapshot(2_000), []);
});

test("snapshot não expõe owner symbol do controller", () => {
  const controller = new LoadingController();
  controller.begin(
    {
      label: "session-bootstrap",
      scope: "auth",
      surface: "viewport",
    },
    10,
  );

  const [snapshot] = controller.getActiveSnapshot(20);
  assert.equal("owner" in snapshot, false);
});
