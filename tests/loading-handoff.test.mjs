import assert from "node:assert/strict";
import test from "node:test";

import { LoadingController } from "../src/components/loading/loading-controller.ts";
import {
  LoadingHandoffController,
  normalizeLoadingDestination,
} from "../src/components/loading/loading-handoff-controller.ts";

test("handoff mantém token ativo até terminal explícito", () => {
  const loading = new LoadingController();
  const handoffs = new LoadingHandoffController();
  const token = loading.begin();

  handoffs.prime({
    key: "login-projects",
    token,
    destination: "/projects",
    now: 100,
  });

  assert.equal(loading.activeCount, 1);
  assert.equal(handoffs.activeCount, 1);
  assert.equal(handoffs.get("login-projects")?.state, "handed-off");

  const claimed = handoffs.claim("login-projects", 150);
  assert.equal(claimed?.state, "claimed");
  assert.equal(claimed?.claimedAt, 150);
  assert.equal(loading.activeCount, 1);

  const completed = handoffs.complete("login-projects");
  assert.equal(completed?.token, token);
  loading.end(completed.token);

  assert.equal(handoffs.activeCount, 0);
  assert.equal(loading.activeCount, 0);
});

test("replacement devolve somente o handoff anterior", () => {
  const loading = new LoadingController();
  const handoffs = new LoadingHandoffController();
  const first = loading.begin();
  const second = loading.begin();

  assert.equal(
    handoffs.prime({
      key: "map:/projects/a/edit",
      token: first,
      destination: "/projects/a/edit",
    }),
    null,
  );

  const previous = handoffs.prime({
    key: "map:/projects/a/edit",
    token: second,
    destination: "/projects/a/edit",
  });

  assert.equal(previous?.token, first);
  loading.end(previous.token);

  assert.equal(loading.activeCount, 1);
  assert.equal(
    handoffs.get("map:/projects/a/edit")?.token,
    second,
  );

  const current = handoffs.complete("map:/projects/a/edit");
  loading.end(current.token);

  assert.equal(loading.activeCount, 0);
  assert.equal(handoffs.activeCount, 0);
});

test("back/forward cancela handoff que não pertence ao location atual", () => {
  const loading = new LoadingController();
  const handoffs = new LoadingHandoffController();
  const login = loading.begin();
  const map = loading.begin();

  handoffs.prime({
    key: "login-projects",
    token: login,
    destination: "/projects",
  });
  handoffs.prime({
    key: "map:/projects/a/edit",
    token: map,
    destination: "/projects/a/edit?tab=map",
  });

  const cancelled = handoffs.cancelOutsideLocation("/projects");

  assert.deepEqual(
    cancelled.map((entry) => entry.key),
    ["map:/projects/a/edit"],
  );
  cancelled.forEach((entry) => loading.end(entry.token));

  assert.equal(handoffs.activeCount, 1);
  assert.equal(loading.activeCount, 1);
  assert.equal(handoffs.get("login-projects")?.token, login);

  const last = handoffs.complete("login-projects");
  loading.end(last.token);
  assert.equal(loading.activeCount, 0);
});

test("cancelAll limpa remount/provider teardown sem timeout", () => {
  const loading = new LoadingController();
  const handoffs = new LoadingHandoffController();

  handoffs.prime({
    key: "one",
    token: loading.begin(),
    destination: "/one",
  });
  handoffs.prime({
    key: "two",
    token: loading.begin(),
    destination: "/two",
  });

  const cancelled = handoffs.cancelAll();
  cancelled.forEach((entry) => loading.end(entry.token));

  assert.equal(cancelled.length, 2);
  assert.equal(handoffs.activeCount, 0);
  assert.equal(loading.activeCount, 0);
});

test("destino normaliza pathname, query e barra final", () => {
  assert.equal(
    normalizeLoadingDestination("https://maps.maonotecnologia.com.br/projects/?page=2"),
    "/projects?page=2",
  );
  assert.equal(
    normalizeLoadingDestination("/projects/a/edit/"),
    "/projects/a/edit",
  );
});
