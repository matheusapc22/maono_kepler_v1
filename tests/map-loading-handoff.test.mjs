import assert from "node:assert/strict";
import test from "node:test";

import {
  clearMapPanelContextHandoff,
  consumeMapPanelContextHandoff,
  primeMapPanelContextHandoff,
} from "../src/pages/Kepler/map-panel/map-panel-context-handoff.ts";

function context({
  mode = "editor",
  slug = "alpha",
  organizationId = 7,
} = {}) {
  return {
    allowed: true,
    mode,
    requestedMode: mode,
    defaultPanel: mode,
    assignedMode: mode,
    project: {
      id: 11,
      slug,
      name: "Alpha",
    },
    organization: {
      id: organizationId,
      name: "Org",
    },
  };
}

test("handoff é consumido uma única vez no destino exato", () => {
  clearMapPanelContextHandoff();
  const value = context();

  primeMapPanelContextHandoff({
    pathname: "/projects/alpha/edit",
    context: value,
    ttlMs: 1_000,
    now: 10_000,
  });

  assert.equal(
    consumeMapPanelContextHandoff({
      pathname: "/projects/alpha/edit",
      organizationKey: "7",
      projectSlug: "alpha",
      mode: "editor",
      now: 10_500,
    }),
    value,
  );

  assert.equal(
    consumeMapPanelContextHandoff({
      pathname: "/projects/alpha/edit",
      organizationKey: "7",
      projectSlug: "alpha",
      mode: "editor",
      now: 10_500,
    }),
    null,
  );
});

test("handoff expira e falha fechado em organização diferente", () => {
  clearMapPanelContextHandoff();
  const value = context();

  primeMapPanelContextHandoff({
    pathname: "/projects/alpha/edit",
    context: value,
    ttlMs: 100,
    now: 20_000,
  });

  assert.equal(
    consumeMapPanelContextHandoff({
      pathname: "/projects/alpha/edit",
      organizationKey: "7",
      projectSlug: "alpha",
      mode: "editor",
      now: 20_101,
    }),
    null,
  );

  primeMapPanelContextHandoff({
    pathname: "/projects/alpha/edit",
    context: value,
    now: 30_000,
  });

  assert.equal(
    consumeMapPanelContextHandoff({
      pathname: "/projects/alpha/edit",
      organizationKey: "8",
      projectSlug: "alpha",
      mode: "editor",
      now: 30_001,
    }),
    null,
  );
});

test("handoff rejeita contexto sem projeto/organização ou modo de criação", () => {
  clearMapPanelContextHandoff();

  assert.throws(
    () =>
      primeMapPanelContextHandoff({
        pathname: "/maps/new/create",
        context: context({ mode: "create" }),
      }),
    /Somente contextos editor\/viewer/,
  );

  assert.throws(
    () =>
      primeMapPanelContextHandoff({
        pathname: "/projects/alpha/edit",
        context: {
          ...context(),
          organization: null,
        },
      }),
    /Contexto de mapa incompleto/,
  );
});
